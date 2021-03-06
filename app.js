const fs = require('fs');
const serializejs = require('serialize-javascript');
const { v4: UUID } = require('uuid');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
    { name: 'config', alias: 'c', type: String, defaultValue: './config.json' },
];

const options = commandLineArgs(optionDefinitions);

global.syzoj = {
  rootDir: __dirname,
  config: require('object-assign-deep')({}, require('./config-example.json'), require(options.config)),
  languages: require('./language-config.json'),
  configDir: options.config,
  models: [],
  modules: [],
  db: null,
  serviceID: UUID(),
  log(obj) {
    if (obj instanceof ErrorMessage) return;
    console.log(obj);
  },
  async run() {
    let Express = require('express');
    global.app = Express();

    syzoj.production = app.get('env') === 'production';
    let winstonLib = require('./libs/winston');
    winstonLib.configureWinston(!syzoj.production);

    this.utils = require('./utility');

    let sccRules = new Map(require('./libs/scc_rules'));
    function codeTabsEmit(func) {
      let lines = func.toString().split('\n');
      let minLen = lines.slice(1).map(line => line.length - line.trimLeft().length).reduce((x, y) => Math.min(x, y));
      return lines.map(line => line.slice(0, minLen).trim().length === 0 ? line.slice(minLen) : line).join('\n');
    }
    let ruleColorizeTask = Array.from(sccRules.values()).forEachAsync(async rule => {
      let showCode = `// The following script is executed by Node.js ${process.version}.\n\n/**\n * Calculate the length of the submitted code being counted.\n * @param {string} code The content of submitted code.\n * @param {string} lang The abbr. of the language used by the code.\n * @returns {number} the length of the submitted code being counted\n */\n${codeTabsEmit(rule[1])}\n\n/**\n * Calculate the player's score for one problem.\n * @param {string} len The shortest code length of this problem for this player.\n * @param {string} minLen The shortest code length of this problem among all players.\n * @returns {number} The score of this problem for this player, can be float.\n */\n${codeTabsEmit(rule[2])}`;
      rule.push(await this.utils.highlight(showCode, syzoj.languages['nodejs'].highlight));
    });
    this.utils.sccRules = sccRules;

    // Set assets dir
    app.use(Express.static(__dirname + '/static', { maxAge: syzoj.production ? '1y' : 0 }));

    // Set template engine ejs
    app.set('view engine', 'ejs');

    // Use body parser
    app.use(Express.urlencoded({
      extended: true,
      limit: '50mb'
    }));
    app.use(Express.json({ limit: '50mb' }));

    // Use cookie parser
    app.use(require('cookie-parser')());
    app.locals.serializejs = serializejs;

    let multer = require('multer');
    app.multer = multer({ dest: syzoj.utils.resolvePath(syzoj.config.upload_dir, 'tmp') });

    // This should before load api_v2, to init the `res.locals.user`
    this.loadHooks();
    // Trick to bypass CSRF for APIv2
    app.use((() => {
      let router = new Express.Router();
      app.apiRouter = router;
      require('./modules/api_v2');
      return router;
    })());

    app.server = require('http').createServer(app);

    await this.connectDatabase();
    this.loadModules();

    // redis and redisCache is for syzoj-renderer
    const redis = require('redis');
    this.redis = redis.createClient(this.config.redis);

    if (require.main === module) {
      // Loaded by node CLI, not by `require()`.

      if (process.send) {
        // if it's started by child_process.fork(), it must be requested to restart
        // wait until parent process quited.
        await new Promise((resolve, reject) => {
          process.on('message', message => {
            if (message === 'quited') resolve();
          });
          process.send('quit');
        });
      }

      await this.lib('judger').connect();

      await ruleColorizeTask;

      app.server.listen(parseInt(syzoj.config.port), syzoj.config.hostname, () => {
        this.log(`SYZOJ is listening on ${syzoj.config.hostname}:${parseInt(syzoj.config.port)}...`);
      });
    }
  },
  restart() {
    console.log('Will now fork a new process.');
    const child = require('child_process').fork(__filename, ['-c', options.config]);
    child.on('message', (message) => {
      if (message !== 'quit') return;

      console.log('Child process requested "quit".')
      child.send('quited', err => {
        if (err) console.error('Error sending "quited" to child process:', err);
        process.exit();
      });
    });
  },
  async connectDatabase() {
    let Sequelize = require('sequelize');

    const cls = require('cls-hooked');
    const namespace = cls.createNamespace('syzoj-cls-hooked-namespace');
    Sequelize.useCLS(namespace);

    this.db = new Sequelize(this.config.db.database, this.config.db.username, this.config.db.password, {
      host: this.config.db.host,
      dialect: 'mysql',
      logging: syzoj.production ? false : syzoj.log,
      timezone: require('moment')().format('Z')
    });
    this.db.Op = Sequelize.Op;
    global.Promise = require('bluebird');
    this.db.countQuery = async (sql, options) => (await this.db.query(`SELECT COUNT(*) FROM (${sql}) AS \`__tmp_table\``, options))[0][0]['COUNT(*)'];
    this.db.clsNameSpace = namespace;

    await this.loadModels();
  },
  loadModules() {
    fs.readdir('./modules/', (err, files) => {
      if (err) {
        this.log(err);
        return;
      }
      files.filter((file) => file.endsWith('.js'))
           .forEach((file) => this.modules.push(require(`./modules/${file}`)));
    });
  },
  async loadModels() {
    await new Promise(resolve => {
      fs.readdir('./models/', (err, files) => {
        if (err) {
          this.log(err);
          return;
        }
        files.filter((file) => file.endsWith('.js'))
             .forEach((file) => require(`./models/${file}`));
        resolve();
      });
    });
    await this.db.sync();
  },
  lib(name) {
    return require(`./libs/${name}`);
  },
  model(name) {
    let result = require(`./models/${name}`);
    if (!result || Object.keys(result).length === 0) {
      console.log('loop reference detected!');
    }
    return result;
  },
  loadHooks() {
    let Session = require('express-session');
    let FileStore = require('session-file-store')(Session);
    let sessionConfig = {
      secret: this.config.session_secret,
      cookie: { httpOnly: false },
      rolling: true,
      saveUninitialized: true,
      resave: true,
      store: new FileStore
    };
    if (syzoj.production) {
      app.set('trust proxy', 1);
      sessionConfig.cookie.secure = false;
    }
    app.use(Session(sessionConfig));

    app.use((req, res, next) => {
      res.locals.useLocalLibs = 'true' !== req.headers['x-remote-access'] || syzoj.config.no_cdn; // !!parseInt(req.headers['syzoj-no-cdn']);

      let User = syzoj.model('user');
      if (req.session.user_id) {
        User.fromID(req.session.user_id).then((user) => {
          res.locals.user = user;
          next();
        }).catch((err) => {
          this.log(err);
          res.locals.user = null;
          req.session.user_id = null;
          next();
        });
      } else {
        if (req.cookies.login) {
          let obj;
          try {
            obj = JSON.parse(req.cookies.login);
            User.findOne({
              where: {
                username: obj[0],
                password: obj[1]
              }
            }).then(user => {
              if (!user) throw null;
              res.locals.user = user;
              req.session.user_id = user.id;
              next();
            }).catch(err => {
              console.log(err);
              res.locals.user = null;
              req.session.user_id = null;
              next();
            });
          } catch (e) {
            res.locals.user = null;
            req.session.user_id = null;
            next();
          }
        } else {
          res.locals.user = null;
          req.session.user_id = null;
          next();
        }
      }
    });

    // Active item on navigator bar
    app.use((req, res, next) => {
      res.locals.active = req.path.split('/')[1];
      next();
    });

    app.use((req, res, next) => {
      res.locals.req = req;
      res.locals.res = res;
      next();
    });

    app.use((req, res, next) => {
      if(syzoj.config.forbidden_remote_access && !res.locals.useLocalLibs && (!res.locals.user || !res.locals.user.is_admin)) {
        if(!req.path.startsWith("/api/login")&&!req.path.startsWith("/login")){
          res.render('error', {
            err: "外部访问被临时禁止！"
          });
        } else next();
      } else next();
    });
  }
};

syzoj.run();
