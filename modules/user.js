const User = syzoj.model('user');
const RatingCalculation = syzoj.model('rating_calculation');
const RatingHistory = syzoj.model('rating_history');
const Contest = syzoj.model('contest');
const ContestPlayer = syzoj.model('contest_player');
const Secret = syzoj.model('secret');

const proxy = require('express-http-proxy');

// Ranklist
app.get('/ranklist', async (req, res) => {
  try {
    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) {
      res.redirect(syzoj.utils.makeUrl(['contest', syzoj.config.cur_vip_contest, 'ranklist']));
    }
    const sort = req.query.sort || syzoj.config.sorting.ranklist.field;
    const order = req.query.order || syzoj.config.sorting.ranklist.order;
    if (!['ac_num', 'rating', 'id', 'username'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let paginate = syzoj.utils.paginate(await User.count({ is_show: true }), req.query.page, syzoj.config.page.ranklist);
    let ranklist = await User.query(paginate, { is_show: true }, [[sort, order]]);
    await ranklist.forEachAsync(async x => x.renderInformation());

    res.render('ranklist', {
      ranklist: ranklist,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/find_user', async (req, res) => {
  try {
    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let user = await User.fromName(req.query.nickname);
    if (!user) throw new ErrorMessage('无此用户。');
    res.redirect(syzoj.utils.makeUrl(['user', user.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// Login
app.get('/login', async (req, res) => {
  if (res.locals.user) {
    res.render('error', {
      err: new ErrorMessage('您已经登录了，请先注销。', { '注销': syzoj.utils.makeUrl(['logout'], { 'url': req.originalUrl }) })
    });
  } else {
    res.render('login');
  }
});

// Sign up
app.get('/sign_up', async (req, res) => {
  if (res.locals.user) {
    res.render('error', {
      err: new ErrorMessage('您已经登录了，请先注销。', { '注销': syzoj.utils.makeUrl(['logout'], { 'url': req.originalUrl }) })
    });
  } else {
    res.render('sign_up');
  }
});

// Logout
app.post('/logout', async (req, res) => {
  req.session.user_id = null;
  req.session.contest_secret = null;
  res.clearCookie('login');
  res.redirect(req.query.url || '/');
});

// User page
app.get('/user/:id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.fromID(id);
    if (!user) throw new ErrorMessage('无此用户。');

    user.ac_problems = await user.getACProblems();
    user.articles = await user.getArticles();
    user.allowedEdit = await user.isAllowedEditBy(res.locals.user);

    let statistics = await user.getStatistics();
    await user.renderInformation();
    user.emailVisible = user.public_email || user.allowedEdit;

    const ratingHistoryValues = await RatingHistory.query(null, { user_id: user.id }, [['rating_calculation_id', 'asc']]);
    let ratingHistories = [{
      contestName: "初始积分",
      value: syzoj.config.default.user.rating,
      delta: null,
      rank: null
    }];

    for (const history of ratingHistoryValues) {
      const contest = await Contest.fromID((await RatingCalculation.fromID(history.rating_calculation_id)).contest_id);
      ratingHistories.push({
        contestName: contest.title,
        value: history.rating_after,
        delta: history.rating_after - ratingHistories[ratingHistories.length - 1].value,
        rank: history.rank,
        participants: await ContestPlayer.count({ contest_id: contest.id })
      });
    }
    ratingHistories.reverse();

    if (syzoj.config.cur_vip_contest) {
      let secret = await Secret.find({user_id: user.id, type: 0, type_id: syzoj.config.cur_vip_contest});
      if (secret) user.spec = secret.extra_info;
      if ((!res.locals.user || !res.locals.user.is_admin) && (!res.locals.user || user.id !== res.locals.user.id)) throw new ErrorMessage('比赛中！');
      if ((!res.locals.user || !res.locals.user.is_admin)) {
        user.ac_problems = [];
        user.articles = [];
        ratingHistories = [];
        user.emailVisible = false;
        statistics = {};
        user.information = '';
      }
    }

    res.render('user', {
      show_user: user,
      statistics: statistics,
      ratingHistories: ratingHistories
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/user/name/:name', async (req, res) => {
  try {
    let username = req.params.name;
    let user = await User.fromName(username);
    if (!user) throw new ErrorMessage('无此用户。');

    res.redirect(syzoj.utils.makeUrl(['user', user.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/user/:id/edit', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.fromID(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    user.privileges = await user.getPrivileges();

    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) {
      user.information = '';
    }

    res.render('user_edit', {
      edited_user: user,
      error_info: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/forget', async (req, res) => {
  res.render('forget');
});



app.post('/user/:id/edit', async (req, res) => {
  let user;
  try {
    let id = parseInt(req.params.id);
    user = await User.fromID(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.body.old_password && req.body.new_password) {
      if (user.password !== User.passwordEncrypt(req.body.old_password) && !await res.locals.user.hasPrivilege('manage_user')) throw new ErrorMessage('旧密码错误。');
      user.password = User.passwordEncrypt(req.body.new_password);
    }

    if (res.locals.user && await res.locals.user.hasPrivilege('manage_user')) {
      if (!syzoj.utils.isValidUsername(req.body.username)) throw new ErrorMessage('无效的用户名。');
      user.username = req.body.username;
      user.email = req.body.email;
    }

    if (res.locals.user && res.locals.user.is_admin) {
      if (!req.body.privileges) {
        req.body.privileges = [];
      } else if (!Array.isArray(req.body.privileges)) {
        req.body.privileges = [req.body.privileges];
      }

      let privileges = req.body.privileges;
      await user.setPrivileges(privileges);
    }

    user.information = req.body.information;
    user.sex = req.body.sex;
    user.public_email = (req.body.public_email === 'on');
    user.prefer_formatted_code = (req.body.prefer_formatted_code === 'on');

    await user.save();

    if (user.id === res.locals.user.id) res.locals.user = user;

    user.privileges = await user.getPrivileges();
    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    res.render('user_edit', {
      edited_user: user,
      error_info: ''
    });
  } catch (e) {
    user.privileges = await user.getPrivileges();
    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    res.render('user_edit', {
      edited_user: user,
      error_info: e.message
    });
  }
});

app.use('/gravatar', proxy(() => {
  try {
    return new URL(syzoj.config.gravatar_url).origin;
  } catch (err) {
    return 'https://www.gravatar.com';
  }
}, {
  filter(req, res) {
    return res.locals.useLocalLibs && syzoj.config.local_gravatar_url === 'inner' && req.method === 'GET';
  },
  memoizeHost: false,
  parseReqBody: false,
  proxyReqPathResolver(req) {
    try {
      return new URL(syzoj.config.gravatar_url).pathname + req.url;
    } catch (err) {
      return '/avatar' + req.url;
    }
  },
  proxyReqOptDecorator(proxyReqOpts) {
    const allows = ['cache-control', 'if-match', 'if-modified-since', 'if-none-match', 'if-unmodified-since', 'user-agent'];
    const map = new Map(Object.entries(proxyReqOpts.headers).map(([key, value]) => [key.toLowerCase(), value]));
    const res = {};
    for (let key of allows) if (map.has(key)) {
      res[key] = map.get(key);
    }
    proxyReqOpts.headers = res;
    return proxyReqOpts;
  },
  userResHeaderDecorator(headers) {
    const allows = ['cache-control', 'expires', 'last-modified', 'etag', 'content-disposition', 'content-length', 'link', 'date', 'content-type', 'pragma', 'vary', 'age'];
    const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    const res = {};
    for (let key of allows) if (map.has(key)) {
      res[key] = map.get(key);
    }
    return res;
  }
}));