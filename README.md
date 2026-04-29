# SQL 实时监控系统

## 功能特性

- 📡 **实时监控**：使用 SSE（服务端推送）实现前端无刷新实时展示 SQL 语句
- 🔍 **智能筛选**：
  - 按执行时间筛选（大于指定秒数）
  - 按 SQL 类型筛选：SELECT / INSERT / UPDATE / DELETE / ALL
- 📋 **详细展示**：执行时间、SQL类型、SQL语句、线程ID、数据库名
- 💾 **数据持久化**：
  - 监控过程中自动记录所有展示过的有效 SQL 数据
  - 监控停止后自动保存为 TXT 文件
  - 支持自定义保存路径
- 🎨 **简洁界面**：自动滚动、实时更新、筛选表单清晰
- ⚡ **高效拉取**：后端每秒从 performance_schema.events_statements_current 拉取数据
- 🛡️ **无侵入**：不影响数据库性能

## 使用说明

### 前置要求

1. MySQL 数据库需要启用 performance_schema（默认已启用）
2. 连接数据库的用户需要有 performance_schema 的读取权限

### 安装与启动

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

### 浏览器访问

打开浏览器访问：`http://localhost:3003`

### 使用步骤

1. **连接数据库**：
   - 输入主机地址（如 localhost）
   - 输入端口（默认 3306）
   - 输入用户名和密码
   - 点击"连接数据库"

2. **配置监控**：
   - 设置执行时间筛选（可选）
   - 选择 SQL 类型筛选（可选）
   - 设置 TXT 文件保存路径

3. **开始监控**：点击"开始监控"按钮

4. **查看数据**：在页面下方实时查看执行的 SQL 语句

5. **停止监控**：点击"停止监控"，数据会自动保存到 TXT 文件

## TXT 文件格式

```
SQL 监控记录
================================================================================

生成时间: 2024/xx/xx xx:xx:xx
记录数量: 10
保存路径: D:\sqllog_app\sql_monitor_2024-xx-xxTxx-xx-xx.txt
================================================================================

1. [2024/xx/xx xx:xx:xx]
类型: SELECT
执行时间: 0.015秒
线程ID: 123
SQL: SELECT * FROM users
数据库: test
--------------------------------------------------------------------------------
```

## 项目结构

```
D:\sqllog_app\
├── app.js              # 后端主程序
├── package.json        # 依赖配置
├── README.md          # 说明文档
└── public/
    └── index.html     # 前端页面
```

## 技术栈

- Node.js
- Express.js
- MySQL2
- SSE (Server-Sent Events)
- HTML5 + CSS3 + JavaScript

## 注意事项

1. 确保 MySQL 已经启用 performance_schema：
   ```sql
   SHOW VARIABLES LIKE 'performance_schema';
   -- 若为 OFF，需在 my.cnf/my.ini 中设置 performance_schema=ON 并重启 MySQL
   ```

2. 确保用户有 performance_schema 读取权限：
   ```sql
   GRANT SELECT ON performance_schema.* TO 'user'@'host';
   ```

3. 监控对数据库性能影响极小，可安全用于生产环境
# SQLLog
