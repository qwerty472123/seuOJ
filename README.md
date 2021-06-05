SYZOJ(https://github.com/syzoj/syzoj) 修改版

# 部署
参考原版 [部署指南](https://github.com/syzoj/syzoj/wiki/%E9%83%A8%E7%BD%B2%E6%8C%87%E5%8D%97)。

# Vendor 内容删改

- `semantic-ui` 删除 `@import url(https://fonts.googleapis.com/css?family=Lato:400,700,400italic,700italic&subset=latin);`
- `blueimp-md5` 删除对 AMD `define` 的支持以解决与 `monaco-editor` 的冲突。

# 升级须知

## 2021/6/1 更新

```sql
alter table contest add column scc_rule text after rank_open_time;
alter table user drop column nameplate;
```

BRAEAKING: Configure for secret classify code's color should be changed.

## 2021/5/4 更新

```sql
alter table secret add column email text after classify_code;
```

## 2020/10/8 更新

```sql
UPDATE judge_state SET score=0 WHERE score IS NULL;
```

## 2020/10/6 更新

```sql
alter table contest_player drop column time_spent;
```

## 2020/10/5 更新

```sql
alter table contest_secret drop index contest_secret_contest_id_secret;
alter table contest_secret drop index contest_secret_contest_id;
alter table contest_secret drop index contest_secret_user_id;
alter table contest_secret drop index contest_secret_user_id_contest_id;
alter table contest_secret rename column contest_id to type_id;
alter table contest_secret add column type int(11) DEFAULT NULL after secret;
update contest_secret set type=0;
RENAME TABLE contest_secret TO secret;
```

## 2020/12/1 更新

需同步升级 judge。

在 sandbox 中 `apt install golang rustc fsharp`。