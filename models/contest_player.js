let Sequelize = require('sequelize');
let db = syzoj.db;

let User = syzoj.model('user');
let Problem = syzoj.model('problem');

let model = db.define('contest_player', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  contest_id: { type: Sequelize.INTEGER },
  user_id: { type: Sequelize.INTEGER },

  score: { type: Sequelize.INTEGER },
  score_details: { type: Sequelize.JSON },
  time_spent: { type: Sequelize.INTEGER },
  language_limit: { type: Sequelize.STRING(20) },
  ban_problems_id: { type: Sequelize.TEXT }
}, {
    timestamps: false,
    tableName: 'contest_player',
    indexes: [
      {
        fields: ['contest_id'],
      },
      {
        fields: ['user_id'],
      }
    ]
  });

let Model = require('./common');
class ContestPlayer extends Model {
  static async create(val) {
    return ContestPlayer.fromRecord(ContestPlayer.model.build(Object.assign({
      contest_id: 0,
      user_id: 0,
      score: 0,
      score_details: {},
      time_spent: 0,
      language_limit: '',
      ban_problems_id: ''
    }, val)));
  }

  static async findInContest(where) {
    return ContestPlayer.findOne({ where: where });
  }

  async loadRelationships() {
    let Contest = syzoj.model('contest');
    this.user = await User.fromID(this.user_id);
    this.contest = await Contest.fromID(this.contest_id);
  }

  getExportable(contest_type) {
    let ret = {
      contest_id: this.contest_id,
      user_id: this.user_id,
      score: this.score,
      score_details: this.score_details,
      time_spent: this.time_spent
    };
    if (contest_type === 'acm') {
      let new_details = [];
      for(let problem of this.score_details) {
        let new_problem = {
          accepted: problem.accepted,
          unacceptedCount: problem.unacceptedCount,
          acceptedTime: problem.acceptedTime,
          judge_id: problem.judge_id,
          submissions: problem.submissions,
          waitingCount: problem.waitingCount,
          curCount: Object.keys(problem.submissions).length - problem.waitingCount
        };
        new_details.push(new_problem);
      }
      ret.score_details = new_details;
    }
    return ret;
  }

  async updateScore(judge_state) {
    await this.loadRelationships();
    if (this.contest.type === 'ioi') {
      if (!judge_state.pending) {
        if (!this.score_details[judge_state.problem_id]) {
          this.score_details[judge_state.problem_id] = {
            score: judge_state.score,
            judge_id: judge_state.id,
            submissions: {}
          };
        }

        this.score_details[judge_state.problem_id].submissions[judge_state.id] = {
          judge_id: judge_state.id,
          score: judge_state.score,
          time: judge_state.submit_time,
          is_waiting: judge_state.status === 'Unknown'
        };

        let arr = Object.values(this.score_details[judge_state.problem_id].submissions);
        arr.sort((a, b) => a.time - b.time);

        let maxScoreSubmission = null, hasWaiting = false;
        for (let x of arr) {
          if (!maxScoreSubmission || x.score >= maxScoreSubmission.score && maxScoreSubmission.score < 100) {
            maxScoreSubmission = x;
          }
          hasWaiting |= x.is_waiting;
        }

        this.score_details[judge_state.problem_id].judge_id = maxScoreSubmission.judge_id;
        this.score_details[judge_state.problem_id].score = maxScoreSubmission.score;
        this.score_details[judge_state.problem_id].time = maxScoreSubmission.time;
        this.score_details[judge_state.problem_id].has_waiting = hasWaiting;

        this.score = 0;
        for (let x in this.score_details) {
          if (this.score != null)
            this.score += this.score_details[x].score;
        }
      }
    } else if (this.contest.type === 'noi') {
      if (this.score_details[judge_state.problem_id] && this.score_details[judge_state.problem_id].judge_id > judge_state.id) return;

      this.score_details[judge_state.problem_id] = {
        score: judge_state.score,
        judge_id: judge_state.id
      };

      this.score = 0;
      for (let x in this.score_details) {
        if (this.score != null)
          this.score += this.score_details[x].score;
      }
    } else if (this.contest.type === 'acm') {
      if (!judge_state.pending) {
        if (!this.score_details[judge_state.problem_id]) {
          this.score_details[judge_state.problem_id] = {
            accepted: false,
            unacceptedCount: 0,
            acceptedTime: 0,
            judge_id: 0,
            submissions: {},
            waitingCount: 0
          };
        }

        this.score_details[judge_state.problem_id].submissions[judge_state.id] = {
          judge_id: judge_state.id,
          accepted: judge_state.status === 'Accepted',
          compiled: judge_state.score != null,
          time: judge_state.submit_time,
          is_waiting: judge_state.status === 'Unknown'
        };

        let arr = Object.values(this.score_details[judge_state.problem_id].submissions);
        arr.sort((a, b) => a.time - b.time);

        this.score_details[judge_state.problem_id].unacceptedCount = 0;
        this.score_details[judge_state.problem_id].judge_id = 0;
        this.score_details[judge_state.problem_id].accepted = 0;
        this.score_details[judge_state.problem_id].waitingCount = 0;
        for (let x of arr) {
          if (x.accepted) {
            this.score_details[judge_state.problem_id].accepted = true;
            this.score_details[judge_state.problem_id].acceptedTime = x.time;
            this.score_details[judge_state.problem_id].judge_id = x.judge_id;
            break;
          } else if (x.compiled) {
            this.score_details[judge_state.problem_id].unacceptedCount++;
          } else if (x.is_waiting) {
            this.score_details[judge_state.problem_id].waitingCount++;
          }
        }

        if (!this.score_details[judge_state.problem_id].accepted) {
          this.score_details[judge_state.problem_id].judge_id = arr[arr.length - 1].judge_id;
        }

        this.score = 0;
        for (let x in this.score_details) {
          if (this.score_details[x].accepted) this.score++;
        }
      }
    } else if (this.contest.type === 'scc') {
      if (!judge_state.pending) {
        if (!this.score_details[judge_state.problem_id]) {
          this.score_details[judge_state.problem_id] = {
            accepted: false,
            minLength: 0,
            judge_id: 0,
            submissions: {},
            has_waiting: false
          };
        }

        await judge_state.loadRelationships();
        this.score_details[judge_state.problem_id].submissions[judge_state.id] = {
          judge_id: judge_state.id,
          accepted: judge_state.status === 'Accepted',
          length: judge_state.problem.type !== 'submit-answer' ? syzoj.utils.calcCodeLength(judge_state.code, judge_state.language) : judge_state.code_length,
          is_waiting: judge_state.status === 'Unknown'
        };

        let arr = Object.values(this.score_details[judge_state.problem_id].submissions);

        this.score_details[judge_state.problem_id].minLength = Infinity;
        this.score_details[judge_state.problem_id].judge_id = 0;
        this.score_details[judge_state.problem_id].accepted = false;
        this.score_details[judge_state.problem_id].has_waiting = false;
        for (let x of arr) if (x.accepted) {
            this.score_details[judge_state.problem_id].accepted = true;
            if (x.length < this.score_details[judge_state.problem_id].minLength) {
              this.score_details[judge_state.problem_id].minLength = x.length;
              this.score_details[judge_state.problem_id].judge_id = x.judge_id;
            }
        } else if (x.is_waiting) {
          this.score_details[judge_state.problem_id].has_waiting = true;
        }

        if (this.score_details[judge_state.problem_id].minLength === Infinity) this.score_details[judge_state.problem_id].minLength = 0;
        if (!this.score_details[judge_state.problem_id].accepted) {
          this.score_details[judge_state.problem_id].judge_id = arr[arr.length - 1].judge_id;
        }

        this.score = 0; // Can't calc here
      }
    }
  }

  getModel() { return model; }
}

ContestPlayer.model = model;

module.exports = ContestPlayer;
