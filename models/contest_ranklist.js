let Sequelize = require('sequelize');
let db = syzoj.db;

let User = syzoj.model('user');
let Problem = syzoj.model('problem');
let ContestPlayer = syzoj.model('contest_player');

let model = db.define('contest_ranklist', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  ranking_params: { type: Sequelize.JSON },
  ranklist: { type: Sequelize.JSON },
  ranking_group_info: { type: Sequelize.JSON },
  freeze_ranking: { type: Sequelize.JSON }
}, {
  timestamps: false,
  tableName: 'contest_ranklist'
});

let Model = require('./common');
class ContestRanklist extends Model {
  static async create(val) {
    return ContestRanklist.fromRecord(ContestRanklist.model.build(Object.assign({
      ranking_params: {},
      ranklist: {},
      ranking_group_info: [],
      freeze_ranking: []
    }, val)));
  }

  async getPlayers() {
    let a = [];
    for (let i = 1; i <= this.ranklist.player_num; i++) {
      a.push(await ContestPlayer.fromID(this.ranklist[i]));
    }
    return a;
  }

  async updatePlayer(contest, player, judge_state) {
    let players = await this.getPlayers(), newPlayer = true;
    for (let x of players) {
      if (x.user_id === player.user_id) {
        newPlayer = false;
        break;
      }
    }

    if (newPlayer && player) {
      players.push(player);
    }

    let JudgeState = syzoj.model('judge_state');

    if (contest.type === 'noi' || contest.type === 'ioi') {
      for (let player of players) {
        player.latest = 0;
        player.score = 0;

        for (let i in player.score_details) {
          let judge_state = await JudgeState.fromID(player.score_details[i].judge_id);
          player.latest = Math.max(player.latest, judge_state.submit_time);

          if (player.score_details[i].score != null) {
            let multiplier = this.ranking_params[i] || 1.0;
            player.score_details[i].weighted_score = Math.round(player.score_details[i].score * multiplier);
            player.score += player.score_details[i].weighted_score;
          }
        }
      }

      players.sort((a, b) => {
        if (a.score > b.score) return -1;
        if (b.score > a.score) return 1;
        if (a.latest < b.latest) return -1;
        if (a.latest > b.latest) return 1;
        return 0;
      });
    } else if (contest.type === 'scc') {
      let minLength = {};
      for (let player of players) {
        for (let i in player.score_details) {
          if (player.score_details[i].accepted) {
            if (!minLength[i] || minLength[i] > player.score_details[i].minLength) minLength[i] = player.score_details[i].minLength;
          }
        }
      }
      for (let player of players) {
        let score = 0;
        for (let i in player.score_details) {
          if (player.score_details[i].accepted) {
            player.score_details[i].score = Math.pow(100,Math.sqrt(minLength[i] / player.score_details[i].minLength));
            score += player.score_details[i].score;
          } else player.score_details[i].score = 0;
        }
        player.score = score;
      }

      players.sort((a, b) => {
        if (a.score > b.score) return -1;
        if (b.score > a.score) return 1;
        return 0;
      });

      for(let player of players) {
        player.score = Math.round(player.score * 100);
        await player.save();
      }
    } else {
      for (let player of players) {
        player.timeSum = 0;
        for (let i in player.score_details) {
          if (player.score_details[i].accepted) {
            player.timeSum += (player.score_details[i].acceptedTime - contest.start_time) + (player.score_details[i].unacceptedCount * 20 * 60);
          }
        }
      }

      players.sort((a, b) => {
        if (a.score > b.score) return -1;
        if (b.score > a.score) return 1;
        if (a.timeSum < b.timeSum) return -1;
        if (a.timeSum > b.timeSum) return 1;
        return 0;
      });
    }

    this.ranklist = { player_num: players.length };
    for (let i = 0; i < players.length; i++) this.ranklist[i + 1] = players[i].id;

    let now = syzoj.utils.getCurrentDate();
    if(contest.freeze_time && now < contest.freeze_time) {
      let freeze_ranking = [];
      for(let player of players) freeze_ranking.push(player.getExportable());
      this.freeze_ranking = [freeze_ranking];
    } else if (judge_state) {
      if (!this.freeze_ranking || this.freeze_ranking.length != 1) {
        this.freeze_ranking = [[]];
      }
      let newPlayer = true;
      for (let x of this.freeze_ranking[0]) if(judge_state.user_id === x.user_id) {
        newPlayer = false;
        if (contest.type === 'scc') {
          x.score_details[judge_state.problem_id].has_waiting = true;
        } else if (contest.type === 'acm') {
          let problem_info = x.score_details[judge_state.problem_id];
          problem_info.waitingCount = Object.keys(player.score_details[judge_state.problem_id].submissions).length - problem_info.curCount;
        }
        break;
      }
      if (newPlayer) {
        let new_player = {
          contest_id: contest.id,
          user_id: judge_state.user_id,
          score: 0,
          score_details: null,
          time_spent: 0
        };
        if (contest.type === 'scc') {
          new_player.score_details = { [judge_state.problem_id]: {
            accepted: false,
            minLength: 0,
            judge_id: 0,
            submissions: { fake: [] },
            has_waiting: true
          } };
        } else  if (contest.type === 'acm') {
          new_player.score_details = { [judge_state.problem_id]: {
            accepted: false,
            unacceptedCount: 0,
            acceptedTime: 0,
            judge_id: 0,
            submissions: { fake: [] },
            waitingCount: 1,
            curCount: 0
          } };
        }
        this.freeze_ranking[0].push(new_player);
      }
    }
  }

  getModel() { return model; }
}

ContestRanklist.model = model;

module.exports = ContestRanklist;
