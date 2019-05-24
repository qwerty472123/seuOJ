let Sequelize = require('sequelize');

let Problem = syzoj.model('problem');
let Article = syzoj.model('article');
let Contest = syzoj.model('contest');
let ArticleComment = syzoj.model('article-comment');
let User = syzoj.model('user');

app.get('/discussion/:type?', async (req, res) => {
  try {
    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) {
      res.redirect(syzoj.utils.makeUrl(['contest', syzoj.config.cur_vip_contest, 'qa']));
    }
    if (!['global', 'problems'].includes(req.params.type)) {
      res.redirect(syzoj.utils.makeUrl(['discussion', 'global']));
    }
    const in_problems = req.params.type === 'problems';

    let where;
    if (in_problems) {
      where = { contest_id: { $eq: null }, problem_id: { $not: null } };
    } else {
      where = { contest_id: { $eq: null }, problem_id: { $eq: null } };
    }
    let paginate = syzoj.utils.paginate(await Article.count(where), req.query.page, syzoj.config.page.discussion);
    let articles = await Article.query(paginate, where, [['sort_time', 'desc']]);

    for (let article of articles) {
      await article.loadRelationships();
      if (in_problems) {
        article.problem = await Problem.fromID(article.problem_id);
      }
    }

    res.render('discussion', {
      articles: articles,
      paginate: paginate,
      problem: null,
      in_problems: in_problems,
      in_contest: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/discussion/problem/:pid', async (req, res) => {
  try {
    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let pid = parseInt(req.params.pid);
    let problem = await Problem.fromID(pid);
    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy(res.locals.user)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let where = { contest_id: { $eq: null }, problem_id: pid };
    let paginate = syzoj.utils.paginate(await Article.count(where), req.query.page, syzoj.config.page.discussion);
    let articles = await Article.query(paginate, where, [['sort_time', 'desc']]);

    for (let article of articles) await article.loadRelationships();

    res.render('discussion', {
      articles: articles,
      paginate: paginate,
      problem: problem,
      in_problems: false,
      in_contest: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/qa', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
    let where;
    if (res.locals.user) where = (await contest.isSupervisior(res.locals.user)) ? { contest_id: contest_id } : { contest_id: contest_id, [Sequelize.Op.or]: [{is_notice: true}, {user_id: res.locals.user.id}] };
    else where = { contest_id: contest_id, is_notice: true};
    if (contest.isEnded()) where = { contest_id: contest_id };
    let paginate = syzoj.utils.paginate(await Article.count(where), req.query.page, syzoj.config.page.discussion);
    let articles = await Article.query(paginate, where, [['is_notice' ,'desc'], ['sort_time', 'desc']]);

    for (let article of articles) await article.loadRelationships();

    res.render('discussion', {
      articles: articles,
      paginate: paginate,
      problem: null,
      in_problems: false,
      in_contest: contest
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/article/:id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let article = await Article.fromID(id);
    if (!article) throw new ErrorMessage('无此帖子。');
    let contest = null;
    if (article.contest_id) {
      if (syzoj.config.cur_vip_contest && article.contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      contest = await Contest.fromID(article.contest_id);
      if ((!contest.is_public || !(contest.isRunning() || contest.isEnded())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');
      if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
    } else {
      if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    }
    await article.loadRelationships();
    article.allowedEdit = await article.isAllowedEditBy(res.locals.user);
    article.allowedComment = await article.isAllowedCommentBy(res.locals.user);
    article.content = await syzoj.utils.markdown(article.content);

    let where = { article_id: id };
    let commentsCount = await ArticleComment.count(where);
    let paginate = syzoj.utils.paginate(commentsCount, req.query.page, syzoj.config.page.article_comment);

    let comments = await ArticleComment.query(paginate, where, [['public_time', 'desc']]);

    for (let comment of comments) {
      comment.content = await syzoj.utils.markdown(comment.content);
      comment.allowedEdit = await comment.isAllowedEditBy(res.locals.user);
      await comment.loadRelationships();
    }

    let problem = null;
    if (article.problem_id) {
      problem = await Problem.fromID(article.problem_id);
      if (!await problem.isAllowedUseBy(res.locals.user)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
    }

    res.render('article', {
      article: article,
      comments: comments,
      paginate: paginate,
      problem: problem,
      commentsCount: commentsCount,
      contest: contest
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/article/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let id = parseInt(req.params.id);
    let article = await Article.fromID(id);

    if (!article) {
      if (req.query.contest_id) {
        let contest = await Contest.fromID(req.query.contest_id);
        if (!contest) throw new ErrorMessage('无对应比赛！');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      }
      article = await Article.create();
      article.id = 0;
      article.allowedEdit = true;
    } else {
      if (article.contest_id) {
        let contest = await Contest.fromID(article.contest_id);
        if (!contest) throw new ErrorMessage('无对应比赛！');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      }
      article.allowedEdit = await article.isAllowedEditBy(res.locals.user);
    }

    res.render('article_edit', {
      article: article
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/article/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let id = parseInt(req.params.id);
    let article = await Article.fromID(id);

    let time = syzoj.utils.getCurrentDate();
    if (!article) {
      article = await Article.create();
      article.user_id = res.locals.user.id;
      article.public_time = article.sort_time = time;

      if (req.query.problem_id) {
        let problem = await Problem.fromID(req.query.problem_id);
        if (!problem) throw new ErrorMessage('无此题目。');
        article.problem_id = problem.id;
      } else {
        article.problem_id = null;
      }

      if (req.query.contest_id) {
        let contest = await Contest.fromID(req.query.contest_id);
        if (!contest) throw new ErrorMessage('无此比赛。');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
        article.contest_id = contest.id;
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        article.contest_id = null;
      }
    } else {
      if (article.contest_id) {
        let contest = await Contest.fromID(article.contest_id);
        if (!contest) throw new ErrorMessage('无对应比赛！');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      }
      if (!await article.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    if (!req.body.title.trim()) throw new ErrorMessage('标题不能为空。');
    article.title = req.body.title;
    article.content = req.body.content;
    article.update_time = time;
    article.is_notice = (res.locals.user && res.locals.user.is_admin ? req.body.is_notice === 'on' : article.is_notice);

    await article.save();

    res.redirect(syzoj.utils.makeUrl(['article', article.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/article/:id/delete', async (req, res) => {
  try {
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let id = parseInt(req.params.id);
    let article = await Article.fromID(id);
    let contest = null;

    if (!article) {
      throw new ErrorMessage('无此帖子。');
    } else {
      if (article.contest_id) {
        contest = await Contest.fromID(article.contest_id);
        if (!contest) throw new ErrorMessage('无对应比赛！');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
        if (!await contest.isSupervisior(res.locals.user) && article.is_notice) throw new ErrorMessage('当前内容为公告，请额外发帖！');
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      }
      if (!await article.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    await article.destroy();
    
    if(contest) res.redirect(syzoj.utils.makeUrl(['contest', contest.id, 'qa']));
    else res.redirect(syzoj.utils.makeUrl(['discussion', 'global']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/article/:id/comment', async (req, res) => {
  try {
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let id = parseInt(req.params.id);
    let article = await Article.fromID(id);

    if (!article) {
      throw new ErrorMessage('无此帖子。');
    } else {
      if (article.contest_id) {
        let contest = await Contest.fromID(article.contest_id);
        if (!contest) throw new ErrorMessage('无对应比赛！');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
        if (!await contest.isSupervisior(res.locals.user) && article.is_notice) throw new ErrorMessage('当前内容为公告，请额外发帖！');
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      }
      if (!await article.isAllowedCommentBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    let comment = await ArticleComment.create({
      content: req.body.comment,
      article_id: id,
      user_id: res.locals.user.id,
      public_time: syzoj.utils.getCurrentDate()
    });

    await comment.save();

    article.sort_time = syzoj.utils.getCurrentDate();
    article.comments_num += 1;
    await article.save();

    res.redirect(syzoj.utils.makeUrl(['article', article.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/article/:article_id/comment/:id/delete', async (req, res) => {
  try {
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let id = parseInt(req.params.id);
    let comment = await ArticleComment.fromID(id);

    if (!comment) {
      throw new ErrorMessage('无此评论。');
    } else {
      await comment.loadRelationships();
      let article = comment.article;
      if (article.contest_id) {
        let contest = await Contest.fromID(article.contest_id);
        if (!contest) throw new ErrorMessage('无对应比赛！');
        if (syzoj.config.cur_vip_contest && contest.id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
        if ((!contest.is_public || !(contest.isRunning())) && !await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('比赛不在进行中！');
        if (!await contest.allowedContestSecret(req, res)) throw new ErrorMessage('您尚未输入Secret。');
        if (!await contest.isSupervisior(res.locals.user) && article.is_notice) throw new ErrorMessage('当前内容为公告，请额外发帖！');
      } else {
        if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      }
      if (!await comment.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    await comment.destroy();

    let article = comment.article;
    article.comments_num -= 1;

    await article.save();

    res.redirect(syzoj.utils.makeUrl(['article', comment.article_id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
