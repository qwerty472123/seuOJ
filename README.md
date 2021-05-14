SYZOJ(https://github.com/syzoj/syzoj) 修改版

# 部署
参考原版 [部署指南](https://github.com/syzoj/syzoj/wiki/%E9%83%A8%E7%BD%B2%E6%8C%87%E5%8D%97)。

# 升级须知

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