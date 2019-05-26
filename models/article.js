let Sequelize = require('sequelize');
let db = syzoj.db;

let User = syzoj.model('user');
let Problem = syzoj.model('problem');
let Contest = syzoj.model('contest');

let model = db.define('article', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },

  title: { type: Sequelize.STRING(80) },
  content: { type: Sequelize.TEXT('medium') },

  user_id: { type: Sequelize.INTEGER },
  problem_id: { type: Sequelize.INTEGER },
  contest_id: { type: Sequelize.INTEGER },

  public_time: { type: Sequelize.INTEGER },
  update_time: { type: Sequelize.INTEGER },
  sort_time: { type: Sequelize.INTEGER },

  comments_num: { type: Sequelize.INTEGER },
  allow_comment: { type: Sequelize.BOOLEAN },

  is_notice: { type: Sequelize.BOOLEAN }
}, {
  timestamps: false,
  tableName: 'article',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['contest_id', 'problem_id']
    },
    {
      fields: ['sort_time']
    },
    {
      fields: ['contest_id', 'is_notice']
    },
    {
      fields: ['contest_id']
    },
    {
      fields: ['contest_id', 'user_id']
    }
  ]
});

let Model = require('./common');
class Article extends Model {
  static async create(val) {
    return Article.fromRecord(Article.model.build(Object.assign({
      title: '',
      content: '',

      user_id: 0,
      problem_id: 0,
      contest_id: 0,

      public_time: 0,
      update_time: 0,
      sort_time: 0,

      comments_num: 0,
      allow_comment: true,

      is_notice: false
    }, val)));
  }

  async loadRelationships() {
    this.user = await User.fromID(this.user_id);
  }

  async isAllowedEditBy(user) {
    if (this.contest_id) {
      this.contest = await Contest.fromID(this.contest_id);
      if (user && await this.contest.isSupervisior(user)) return true;
      if (this.is_notice) return false;
    }
    return user && (user.is_admin || this.user_id === user.id);
  }

  async isAllowedCommentBy(user) {
    if (this.contest_id) {
      this.contest = await Contest.fromID(this.contest_id);
      if (user && await this.contest.isSupervisior(user)) return true;
      if (this.is_notice) return false;
      return user && this.user_id === user.id;
    }
    return user && (this.allow_comment || user.is_admin || this.user_id === user.id);
  }

  async resetReplyCountAndTime() {
    let ArticleComment = syzoj.model('article-comment');
    await syzoj.utils.lock(['Article::resetReplyCountAndTime', this.id], async () => {
      this.comments_num = await ArticleComment.count({ article_id: this.id });
      if (this.comments_num === 0) {
        this.sort_time = this.public_time;
      } else {
        this.sort_time = await ArticleComment.model.max('public_time', { where: { article_id: this.id } });
      }
      await this.save();
    });
  }

  getModel() { return model; }
};

Article.model = model;

module.exports = Article;
