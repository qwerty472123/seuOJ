let Sequelize = require('sequelize');
let db = syzoj.db;

let model = db.define('secret', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  secret: { type: Sequelize.STRING(120) },
  // 0 for contest secret, 1 for domain secret - not impl yet
  type: { type: Sequelize.INTEGER },
  type_id: { type: Sequelize.INTEGER },
  user_id: { type: Sequelize.INTEGER },
  extra_info: { type: Sequelize.TEXT },
  classify_code: { type: Sequelize.INTEGER },
  email: { type: Sequelize.TEXT }
}, {
    timestamps: false,
    tableName: 'secret',
    indexes: [
      {
        fields: ['type', 'type_id'],
      },
      {
        fields: ['type', 'user_id'],
      },
      {
        fields: ['type', 'type_id', 'secret'],
        unique: true
      },
      {
        fields: ['type', 'user_id', 'type_id']
      }
    ]
  });

let Model = require('./common');
class Secret extends Model {
  static async create(val) {
    return Secret.fromRecord(Secret.model.build(Object.assign({
      secret: '',
      type_id: 0,
      user_id: -1,
      extra_info: '',
      classify_code: 0,
      email: ''
    }, val)));
  }

  async loadRelationships() {
    if (this.user_id < 0) {
      this.user = null;
      this.user_desc = '暂未绑定';
      return;
    }
    const User = syzoj.model('user');
    this.user = await User.fromID(this.user_id);
    this.user_desc = this.user.username;
  }

  static async find(where) {
    return Secret.findOne({ where: where });
  }

  getModel() { return model; }
}

Secret.model = model;

module.exports = Secret;
