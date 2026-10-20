# 小黑板：数据库版接入说明

已完成数据库留言与 Supabase 邮箱验证码登录的接入代码（本地提交 `bd0b44f`）。**2026-10-20 已在 Turso 网页控制台创建并核验两张留言表和索引**；Supabase项目已Healthy，用户已保存自定义SMTP，首次注册及再次登录的数字验证码模板均已保存，Site URL已核对。163发件邮箱已在Brevo核对为Verified；Vercel登录与变量、远端推送、生产部署和真实跨设备验收未完成，不能称网站登录已经可用。

## 已实现

- 昵称、联系邮箱、留言及管理员回复保存在数据库，访客对话按服务端确认的公开账号标识隔离；邮箱不参与身份认证，相同邮箱的不同账号不会共享对话。
- 访客接口只读取当前账号的对话；客户端指定其他账号、对话或发送者角色不能改变访问范围。管理员接口复用网站现有后台访问检查。
- 同一条消息重试不会重复写入；服务器校验昵称、邮箱和500字内容限制。读取失败、发送失败、数据库未迁移均有明确提示，不虚报发送成功，失败草稿保留。
- 页面首次打开、重新获得焦点、点击刷新时从服务端读取对话。无需改动 CNB 抓取流程。
- 登录采用官方 `@supabase/ssr` 和 `@supabase/supabase-js`，只在服务端路由调用；SDK 管理 HttpOnly、SameSite=Lax、生产环境 Secure 的登录 Cookie，不把登录凭据返回页面或写入源码。助手只编写引用配置变量名的代码，不读取、填写、使用或测试用户的真实配置、验证码及会话。旧浏览器演示数据不删除、不自动上传。

## 1. 数据库升级（已完成）

在 Turso 对应数据库的 SQL console 中，执行 `drizzle/0002_blackboard.sql`。全部为 `CREATE ... IF NOT EXISTS`，可重复执行，只新增两个留言表及索引，不改动项目、任务和归档数据。新数据库的完整建表脚本 `db/turso-init.sql` 也已补齐。

本次经用户授权，在已登录的 Turso 网页逐条执行，并查询 `sqlite_master` 确认存在 `blackboard_threads`、`blackboard_messages`、`blackboard_messages_thread_created` 三个对象；未读取任何 API Key 或连接令牌。

本项目的既有迁移日志未登记 `0001_cnb_refresh_jobs.sql`，本轮不修订历史迁移账本；**不能假定推送代码会自动执行新 SQL**，也不要盲跑全量迁移。按上述 SQL console 方式单独新增留言表即可。

## 2. 创建并配置 Supabase 免费项目（用户本人操作）

1. 打开 https://supabase.com/dashboard ，本人登录或注册，创建 **Free** 项目，名称可用 `reits-weekly-auth`。数据库密码由本人管理；留言继续保存在现有 Turso，不迁移到 Supabase。
2. Authentication → URL Configuration：Site URL 填 `https://reits-weekly-trace.vercel.app`。保留邮箱身份验证，不关闭邮箱确认，不启用匿名登录作为留言身份。本实现使用输入数字验证码，**不需要**新增邮件链接回调地址。
3. **先配置SMTP，再修改模板**：当前后台未配置自定义SMTP时禁止编辑模板。默认发信仅团队邮箱、每小时2封，不能据此开放任意访客登录。本次选用Brevo Free；发件人必须验证，且Supabase的Sender email address必须与Brevo已验证的邮箱完全一致。Host为`smtp-relay.brevo.com`，端口587；SMTP Login及SMTP key由用户本人查看/填写，助手不得访问密钥页面或读取、创建、复制这些值。注册成功或保存SMTP不等于实际发信已经成功，仍需用户本人验收送达。
4. Authentication → Emails → Templates：同时修改 **Magic link or OTP** 和 **Confirm sign up** 为数字验证码邮件。新用户及未确认用户可能走首次注册模板，仅修改Magic Link会让新访客仍收到链接。模板变量不是实际验证码，可填：

   ```html
   <h2>REITs 小黑板登录</h2>
   <p>您的登录验证码是：{{ .Token }}</p>
   <p>请返回网站输入此验证码。如果不是您操作，请忽略此邮件。</p>
   ```

5. 在 Vercel 项目 Settings → Environment Variables 中，由本人新增以下**服务端变量**，选择 Production（需要预览时另选 Preview）：

   | 变量名 | 用户填写内容 |
   | --- | --- |
   | `SUPABASE_URL` | 自己项目的 Project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | 自己项目的 Publishable key |

   不要填 `service_role` 或 secret key，不在对话、截图、源码或提交中展示真实值。无需在 CNB 添加这些变量。助手不得打开、读取或代填这些值。
6. 配置保存后部署新版本。修改环境变量后，需要重新部署才能对新部署生效。

官方SDK当前要求Node.js 22以上，package.json最低版本已同步；CNB现有镜像为node:22-bookworm，无需更改。Vercel应使用22或更新的受支持版本。

参考：[SSR客户端](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[邮箱验证码与模板](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[默认发信限制](https://supabase.com/docs/guides/auth/auth-smtp)、[免费方案](https://supabase.com/pricing)。免费额度和政策以官方当时页面为准；免费项目长期不活跃可能暂停，不能保证永久免费或一直在线。

## 3. 登录代码与身份边界

- `lib/blackboard-identity.ts` 调用服务端 `getUser()` 验证账号，仅接受已确认邮箱的非匿名用户，按 `supabase:<公开账号ID>` 隔离对话；未登录返回 `null`，未配置返回503。`getSession()`、普通邮箱、请求正文和未验证请求头都不能提供留言身份。
- `lib/blackboard-supabase.ts` 封装官方SDK，验证码发送/确认/退出均在路由处理；页面不接收会话、API Key 或刷新凭据，不需要浏览器端 Supabase 配置。没有读取会话的 Server Component，故无需给全站新增 Proxy；路由本身可更新 Cookie。
- `/api/blackboard/auth` 提供登录状态、发验证码、验证和退出。`lib/blackboard-auth.ts` 仅返回公开账号资料或固定提示；错误不回显服务端原始诊断。
- 登录、退出和留言写入必须具有与网站完全相同的 Origin 且为 JSON；拒绝跨站及无 Origin 的写入，不接受凭邮箱读取私密记录。
- 页面提供发送、重发倒计时、数字验证码登录和退出。切换账号时重建对话组件；退出立即隐藏对话、清空草稿，失败保留“重试退出”提示，不冒称退出成功。同源其他标签通过不含凭据的通知重新确认身份，页面获得焦点时也重新确认。登录状态读取失败时隐藏对话，不以旧状态继续显示。

仅建表或仅推送代码不足以开放登录；必须完成上述项目、邮件模板、发信与环境变量配置，并由本人实际验收。

## 4. 接口约定

所有正常响应及小黑板错误响应均使用 `Cache-Control: no-store`，私密内容不经公共缓存共享。

| 接口 | 行为 |
| --- | --- |
| `GET /api/blackboard/auth` | 确认访客身份，仅返回公开账号ID及邮箱，未登录为 `user: null` |
| `POST /api/blackboard/auth` | `send-code` / `verify-code` / `sign-out`，不返回会话数据 |
| `GET /api/blackboard` | 经过访客身份检查后，返回当前账号的 `thread`，未创建时为 `null` |
| `POST /api/blackboard` | `action: enter` 接收昵称和邮箱；`action: send` 接收公开消息编号与正文，发送者和所属对话均由服务端确定 |
| `GET /api/admin/blackboard` | 通过既有管理员检查后返回留言列表 |
| `POST /api/admin/blackboard` | 通过既有管理员检查后，按 `threadId` 回复；接收公开消息编号与正文，发送者固定为管理员 |

公开消息编号是去重用的行标识，不提供读取或登录权限。访客账号标识只在服务器使用，不包含在返回的对话数据中。

## 5. 验证与上线

已在白名单隔离环境运行7项新增测试：留言保存—独立后台读取—回复—另一设备模拟读取、同邮箱不同账号隔离、未接入/未登录拒绝且零数据库访问、服务端输入校验、重发去重与编号冲突、异常请求/SQL字符按文本处理、可重复建表及安全错误分类。测试只用内存库、公开模拟账号ID和测试联系邮箱，不接触真实数据库或认证凭据。

另在本机临时内存预览中检查了未开放时禁用输入/发送、模拟访客提交、后台回复、访客刷新看到回复、另一模拟账号无法看到原对话。模拟身份仅存在于 `/private/tmp/` 的临时预览脚本，未放入生产代码；截图不能充当真实登录或线上验收证据。

用户配置真实登录、执行建表并部署后，还需要本人验收：

1. 访客甲在一台设备登录并留言，管理员在自己的设备看到并回复。
2. 甲在同账号另一设备登录后看到这段回复。
3. 访客乙即使填写相同邮箱，也看不到甲的记录；退出后不能继续读取私密对话。
4. 网络中断、重复点击或重试不虚报成功、不重复发送，不将技术错误详情暴露给访客。

新增4项登录接口测试：公开身份/登录/退出、跨站及非JSON拒绝、无效输入零服务调用、验证码失败/限流/未配置/固定错误提示。连同原有测试共178项隔离测试通过，类型检查及本轮源文件lint通过。使用纯本机内存模拟页面检查了登录、发留言、退出隐藏、另一账号无旧对话、未配置禁用输入；未访问真实登录服务，未发送邮件，未读取用户任何密钥或验证码。模拟页面不能作为线上验收证据。

推送命令由用户在自己的终端执行（使用用户自己管理的仓库登录）：

```bash
cd "/Users/DELL/Documents/For Codex/reits-weekly-live"
git push github main
git push cnb main
```

Vercel 对应提交显示 **Ready / Production** 后，用户本人完成前述四项跨设备验收。助手尚未推送或部署，真实登录配置未完成。
