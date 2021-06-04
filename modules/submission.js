let JudgeState = syzoj.model('judge_state');
let FormattedCode = syzoj.model('formatted_code');
let User = syzoj.model('user');
let Contest = syzoj.model('contest');
let Problem = syzoj.model('problem');

const jwt = require('jsonwebtoken');
const sim = require('@4qwerty7/sim-node');
const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

const displayConfig = {
  showScore: true,
  showUsage: true,
  showCode: true,
  showResult: true,
  showOthers: true,
  showTestdata: true,
  showDetailResult: true,
  inContest: false,
  showRejudge: false
};

// s is JudgeState
app.get('/submissions', async (req, res) => {
  try {
    const curUser = res.locals.user;
    let user = await User.fromName(req.query.submitter || '');
    let where = {};
    let inContest = false;
    let contestProblemsId = null;
    let allowLangs = null;
    if (user) where.user_id = user.id;
    else if (req.query.submitter) where.user_id = -1;

    let contest = null;
    if (!req.query.contest) {
      if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) {
        res.redirect(syzoj.utils.makeUrl(['contest', syzoj.config.cur_vip_contest, 'submissions']));
      }
      where.type = { [syzoj.db.Op.eq]: 0 };
    } else {
      const contestId = Number(req.query.contest);
      if (syzoj.config.cur_vip_contest && contestId !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      contest = await Contest.fromID(contestId);
      contest.ended = contest.isEnded();
      if ((contest.ended && contest.is_public) || // If the contest is ended and is not hidden
        (curUser && await contest.isSupervisior(curUser)) // Or if the user have the permission to check
      ) {
        where.type = { [syzoj.db.Op.eq]: 1 };
        where.type_info = { [syzoj.db.Op.eq]: contestId };
        inContest = true;
        contestProblemsId = await contest.getProblems();
        if (contest.allow_languages) allowLangs = contest.allow_languages.split('|');
      } else {
        throw new Error("您暂时无权查看此比赛的详细评测信息。");
      }
    }

    let minScore = parseInt(req.query.min_score);
    let maxScore = parseInt(req.query.max_score);

    if (!isNaN(minScore) || !isNaN(maxScore)) {
      if (isNaN(minScore)) minScore = 0;
      if (isNaN(maxScore)) maxScore = 100;
      if (!(minScore === 0 && maxScore === 100)) {
        where.score = {
          [syzoj.db.Op.and]: {
            [syzoj.db.Op.gte]: parseInt(minScore),
            [syzoj.db.Op.lte]: parseInt(maxScore)
          }
        };
      }
    }

    if (req.query.language) {
      if (req.query.language === 'submit-answer') where.language = { [syzoj.db.Op.or]: [{ [syzoj.db.Op.eq]: '',  }, { [syzoj.db.Op.eq]: null }] };
      else if (req.query.language === 'non-submit-answer') where.language = { [syzoj.db.Op.not]: '' };
      else where.language = req.query.language;
    }
    if (req.query.status) where.status = { [syzoj.db.Op.like]: req.query.status + '%' };

    if (!inContest && (!curUser || !await curUser.hasPrivilege('manage_problem'))) {
      if (req.query.problem_id) {
        let problem_id = parseInt(req.query.problem_id);
        let problem = await Problem.fromID(problem_id);
        if (!problem)
          throw new ErrorMessage("无此题目。");
        if (await problem.isAllowedUseBy(res.locals.user)) {
          where.problem_id = {
            [syzoj.db.Op.and]: [
              { [syzoj.db.Op.eq]: where.problem_id = problem_id }
            ]
          };
        } else {
          throw new ErrorMessage("您没有权限进行此操作。");
        }
      } else {
        where.is_public = {
          [syzoj.db.Op.eq]: true,
        };
      }
    } else if (req.query.problem_id) {
      where.problem_id = (inContest ? contestProblemsId[syzoj.utils.alphaIdParse(req.query.problem_id) - 1] : parseInt(req.query.problem_id)) || -1;
    }

    let isFiltered = !!(where.problem_id || where.user_id || where.score || where.language || where.status);

    let paginate = syzoj.utils.paginate(await JudgeState.count(where), req.query.page, syzoj.config.page.judge_state);
    let judge_state = await JudgeState.query(paginate, where, [['id', 'desc']], true);

    await judge_state.forEachAsync(async obj => {
      await obj.loadRelationships();
      if (inContest) {
        await obj.loadSecret(contest);
        obj.problem.title = syzoj.utils.removeTitleTag(obj.problem.title);
      }
    });

    let viewConfig = displayConfig;
    if (inContest) {
      viewConfig = JSON.parse(JSON.stringify(displayConfig));
      viewConfig.pidMap = Object.fromEntries(contestProblemsId.map((x, idx) => [x, syzoj.utils.idToAlpha(idx + 1)]));
    }

    res.render('submissions', {
      // judge_state: judge_state,
      items: judge_state.map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (x.pending && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: 'rough',
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig, true),
        running: false,
      })),
      paginate: paginate,
      pushType: 'rough',
      form: req.query,
      displayConfig: viewConfig,
      isFiltered: isFiltered,
      allowLangs: allowLangs,
      contest,
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/submissions/diff/:a_id/:b_id', async (req, res) => {
  try {
    const curUser = res.locals.user;
    const a_id = parseInt(req.params.a_id);
    const b_id = parseInt(req.params.b_id);
    const a_judge = await JudgeState.fromID(a_id);
    const b_judge = await JudgeState.fromID(b_id);
    if (!a_judge || !b_judge) throw new ErrorMessage("提交记录 ID 不正确。");
    if (!await a_judge.isAllowedVisitBy(curUser) || !await b_judge.isAllowedVisitBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    let contest_a = null;
    if (a_judge.type === 1) {
      let contest = await Contest.fromID(a_judge.type_info);
      contest_a = contest;
      if (syzoj.config.cur_vip_contest && a_judge.type_info !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      contest.ended = contest.isEnded();

      if ((!contest.ended || !contest.is_public) &&
        !(await a_judge.problem.isAllowedEditBy(res.locals.user) || await contest.isSupervisior(curUser))) {
        throw new Error("比赛未结束或未公开。");
      }
      await a_judge.loadSecret(contest);
    } else {
      if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    }
    if (b_judge.type === 1) {
      let contest = (contest_a && contest_a.id === b_judge.type_info) ? contest_a : await Contest.fromID(b_judge.type_info);
      if (syzoj.config.cur_vip_contest && b_judge.type_info !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      contest.ended = contest.isEnded();

      if ((!contest.ended || !contest.is_public) &&
        !(await b_judge.problem.isAllowedEditBy(res.locals.user) || await contest.isSupervisior(curUser))) {
        throw new Error("比赛未结束或未公开。");
      }
      await b_judge.loadSecret(contest);
    } else {
      if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    }

    await a_judge.loadRelationships();
    await b_judge.loadRelationships();

    if (a_judge.problem.type === 'submit-answer' || b_judge.problem.type === 'submit-answer') {
      throw new Error("不是受支持的格式。");
    }

    let contest = null;
    if (a_judge.type === 1 && b_judge.type === 1 && a_judge.type_info === b_judge.type_info) {
      contest = contest_a;
    }

    let rate = null;
    let simType = syzoj.languages[a_judge.language].sim;
    if (!simType) simType = 'c++';
    if (req.query.rate && sim.supportedTypes.includes(req.query.rate)) simType = req.query.rate;
    if (!sim.supportedTypes.includes(simType)) simType = sim.supportedTypes[0];
    if (req.query.rate && res.locals.user && res.locals.user.is_admin) {
      try {
        const diffs = await sim(simType, { a: a_judge.code, b: b_judge.code });
        if (diffs.length > 0) rate = diffs[0][2];
        else rate = 0;
      } catch (err) {
        // error
        rate = 'err';
      }
    }

    res.render('submissions_diff', {
      items: [a_judge, b_judge].map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (x.pending && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: 'rough',
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig, true),
        running: false,
      })),
      pushType: 'rough',
      displayConfig: displayConfig,
      a_id: a_judge.id, b_id: b_judge.id,
      a_code: a_judge.code, b_code: b_judge.code,
      a_lang: syzoj.languages[a_judge.language].editor,
      b_lang: syzoj.languages[b_judge.language].editor,
      contest,
      rate, simType,
      can_rate: !req.query.rate && res.locals.user && res.locals.user.is_admin
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/submission/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const judge = await JudgeState.fromID(id);
    if (!judge) throw new ErrorMessage("提交记录 ID 不正确。");
    const curUser = res.locals.user;
    if (!await judge.isAllowedVisitBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    let contest = null;;
    if (judge.type === 1) {
      contest = await Contest.fromID(judge.type_info);
      if (syzoj.config.cur_vip_contest && judge.type_info !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
      contest.ended = contest.isEnded();

      if ((!contest.ended || !contest.is_public) &&
        !(await judge.problem.isAllowedEditBy(res.locals.user) || await contest.isSupervisior(curUser))) {
        throw new Error("比赛未结束或未公开。");
      }
      await judge.loadSecret(contest);
    } else {
      if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    }

    await judge.loadRelationships();

    if (judge.problem.type !== 'submit-answer') {
      let key = syzoj.utils.getFormattedCodeKey(judge.code, judge.language);
      if (key) {
        let formattedCode = await FormattedCode.findOne({
          where: {
            key: key
          }
        });

        if (formattedCode) {
          judge.formattedCode = await syzoj.utils.highlight(formattedCode.code, syzoj.languages[judge.language].highlight);
        }
      }
      judge.code = await syzoj.utils.highlight(judge.code, syzoj.languages[judge.language].highlight);
    }

    displayConfig.showRejudge = await judge.problem.isAllowedEditBy(res.locals.user);
    res.render('submission', {
      info: getSubmissionInfo(judge, displayConfig),
      roughResult: getRoughResult(judge, displayConfig, false),
      code: (judge.problem.type !== 'submit-answer') ? judge.code.toString("utf8") : '',
      formattedCode: judge.formattedCode ? judge.formattedCode.toString("utf8") : null,
      preferFormattedCode: res.locals.user ? res.locals.user.prefer_formatted_code : true,
      detailResult: processOverallResult(judge.result, displayConfig),
      socketToken: (judge.pending && judge.task_id != null) ? jwt.sign({
        taskId: judge.task_id,
        type: 'detail',
        displayConfig: displayConfig
      }, syzoj.config.session_secret) : null,
      displayConfig: displayConfig,
      contest
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/submission/:id/rejudge', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let judge = await JudgeState.fromID(id);

    if (judge.pending && !(res.locals.user && await res.locals.user.hasPrivilege('manage_problem'))) throw new ErrorMessage('无法重新评测一个评测中的提交。');

    await judge.loadRelationships();

    let allowedRejudge = await judge.problem.isAllowedEditBy(res.locals.user);
    if (!allowedRejudge) throw new ErrorMessage('您没有权限进行此操作。');

    await judge.rejudge();

    res.redirect(syzoj.utils.makeUrl(['submission', id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
