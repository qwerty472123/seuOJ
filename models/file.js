let Sequelize = require('sequelize');
let db = syzoj.db;

let model = db.define('file', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  type: { type: Sequelize.STRING(80) },
  md5: { type: Sequelize.STRING(80), unique: true }
}, {
  timestamps: false,
  tableName: 'file',
  indexes: [
    {
      fields: ['type'],
    },
    {
      fields: ['md5'],
    }
  ]
});

let Model = require('./common');
class File extends Model {
  static create(val) {
    return File.fromRecord(File.model.build(Object.assign({
      type: '',
      md5: ''
    }, val)));
  }

  getPath() {
    return File.resolvePath(this.type, this.md5);
  }

  static resolvePath(type, md5) {
    return syzoj.utils.resolvePath(syzoj.config.upload_dir, type, md5);
  }

  // data: Array of { filename: string, data: buffer or string }
  static async zipFiles(files) {
    let tmp = require('tmp-promise');
    let dir = await tmp.dir(), path = require('path'), fs = require('fs-extra');
    let filenames = await files.mapAsync(async file => {
      let fullPath = path.join(dir.path, file.filename);
      await fs.writeFileAsync(fullPath, file.data);
      return fullPath;
    });

    let p7zip = require('node-7z'), zipFile = await tmp.tmpName() + '.zip';
    await new Promise((resolve, reject) => p7zip.add(zipFile, filenames).on('end', resolve).on('error', reject));

    await fs.removeAsync(dir.path);

    return zipFile;
  }

  static async getUnzipInfoFromPath(path) {
    try {
      let p7zip = require('node-7z');
      let size = 0, count = 0;
      let stream = p7zip.list(path);
      stream.on('data', file => {
        count++;
        size += file.size;
      });
      await new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
      return { size, count };
    } catch (e) {
      return { size: null, count: null };
    }
  }

  static async upload(path, type, noLimit) {
    let fs = Promise.promisifyAll(require('fs-extra'));

    let buf = await fs.readFileAsync(path);

    if (!noLimit && buf.length > syzoj.config.limit.data_size) throw new ErrorMessage('数据包太大。');

    this.unzipSize = (await File.getUnzipInfoFromPath(path)).size;

    let key = syzoj.utils.md5(buf);
    await fs.moveAsync(path, File.resolvePath(type, key), { overwrite: true });

    let file = await File.findOne({ where: { md5: key } });
    if (!file) {
      file = await File.create({
        type: type,
        md5: key
      });
      await file.save();
    }

    return file;
  }

  async getUnzipSize() {
    if (this.unzipSize === undefined)  {
      this.unzipSize = (await File.getUnzipInfoFromPath(this.getPath())).size;
    }

    if (this.unzipSize === null) throw new ErrorMessage('无效的 ZIP 文件。');
    else return this.unzipSize;
  }

  async remove() {
    let fs = require('fs-extra');
    await fs.remove(this.getPath());
    await this.destroy();
  }

  getModel() { return model; }
}

File.model = model;

module.exports = File;
