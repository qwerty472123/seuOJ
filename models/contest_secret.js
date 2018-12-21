/*
 *  This file is part of seuOJ.
 *
 *  Copyright (c) 2018 4qwerty7 <4qwerty7@163.com>
 *
 *  SYZOJ is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  SYZOJ is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public
 *  License along with SYZOJ. If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

let Sequelize = require('sequelize');
let db = syzoj.db;

let model = db.define('contest_secret', {
  secret: { type: Sequelize.STRING(120), primaryKey: true },
  contest_id: { type: Sequelize.INTEGER },
  user_id: { type: Sequelize.INTEGER },
  extra_info: { type: Sequelize.TEXT },
  classify_code: { type: Sequelize.INTEGER }
}, {
    timestamps: false,
    tableName: 'contest_secret',
    indexes: [
      {
        fields: ['contest_id'],
      },
      {
        fields: ['user_id'],
      },
      {
          fields: ['secret'],
      },
      {
        fields: ['user_id', 'contest_id']
      }
    ]
  });

let Model = require('./common');
class ContestSecret extends Model {
  static async create(val) {
    return ContestSecret.fromRecord(ContestSecret.model.build(Object.assign({
      secret: '',
      contest_id: 0,
      user_id: -1,
      extra_info: '',
      classify_code: 0
    }, val)));
  }

  static async find(where) {
    return ContestSecret.findOne({ where: where });
  }

  getModel() { return model; }
}

ContestSecret.model = model;

module.exports = ContestSecret;
