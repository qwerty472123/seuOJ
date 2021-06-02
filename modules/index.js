let User = syzoj.model('user');
let Article = syzoj.model('article');
let Contest = syzoj.model('contest');
let Problem = syzoj.model('problem');
let TimeAgo = require('javascript-time-ago');
let zh = require('javascript-time-ago/locale/zh');
TimeAgo.locale(zh);
const timeAgo = new TimeAgo('zh-CN');

app.get('/', async (req, res) => {
  try {
    let ranklist = await User.query([1, syzoj.config.page.ranklist_index], { is_show: true }, [[syzoj.config.sorting.ranklist.field, syzoj.config.sorting.ranklist.order]]);
    await ranklist.forEachAsync(async x => x.renderInformation());

    let notices = (await Article.query(null, { contest_id: { $eq: null }, is_notice: true }, [['public_time', 'desc']])).map(article => ({
      title: article.title,
      url: syzoj.utils.makeUrl(['article', article.id]),
      date: syzoj.utils.formatDate(article.public_time, 'L')
    }));

    let contests = await Contest.query([1, 5], { is_public: true }, [['start_time', 'desc']]);

    let problems = (await Problem.query([1, 5], { is_public: true }, [['publicize_time', 'desc']])).map(problem => ({
      id: problem.id,
      title: problem.title,
      time: timeAgo.format(new Date(problem.publicize_time)),
    }));

    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) {
      ranklist = [];
      notices = [];
      contests = await Contest.query([1, 1], { id: syzoj.config.cur_vip_contest, is_public: true }, [['start_time', 'desc']]);
      problems = [];
    }

    res.render('index', {
      ranklist: ranklist,
      notices: notices,
      contests: contests,
      problems: problems,
      links: syzoj.config.links
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/help', async (req, res) => {
  try {
    res.render('help');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
