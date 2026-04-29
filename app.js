const express = require('express');
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3003;

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

let monitoring = false;
let sqlData = [];
let dbConfig = null;
let connection = null;
let savePath = './';
let configType = 'ALL';
let configDuration = 0;
let processedEventIds = new Set();
let lastTimerEnd = 0;
let fetchIntervalId = null;
let fileCounter = 1;
const SAVE_THRESHOLD = 2000;

function createConnection(config) {
  const conn = mysql.createConnection({
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: 'performance_schema',
    connectTimeout: 10000
  });

  conn.on('error', (err) => {
    console.error('数据库连接错误:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('连接丢失，尝试重连...');
    } else {
      console.log('其他数据库错误:', err);
    }
  });

  return conn;
}

function testConnection(config) {
  return new Promise((resolve, reject) => {
    const conn = createConnection(config);
    conn.connect((err) => {
      if (err) {
        conn.end();
        reject(err);
      } else {
        conn.end();
        resolve(true);
      }
    });
  });
}

async function fetchSQLData() {
  if (!connection || !monitoring) return;

  try {
    const [rows] = await connection.promise().query(`
      SELECT
        event_id,
        thread_id,
        event_name,
        timer_start,
        timer_end,
        sql_text,
        current_schema
      FROM events_statements_history
      WHERE sql_text IS NOT NULL
        AND sql_text != ''
        AND sql_text NOT LIKE '%performance_schema%'
        AND sql_text NOT LIKE '%SHOW %'
        AND sql_text NOT LIKE '%SELECT @@%'
        AND sql_text NOT LIKE '%SET %'
        ${lastTimerEnd > 0 ? `AND timer_end > ${lastTimerEnd}` : ''}
      ORDER BY timer_start DESC
    `);

    const now = Date.now();
    const newEvents = [];

    rows.forEach(row => {
      if (row.sql_text && row.sql_text.trim() && !processedEventIds.has(row.event_id)) {
        const duration = row.timer_end ? (row.timer_end - row.timer_start) / 1e9 / 1000 : 0;

        let sqlType = 'UNKNOWN';
        const sqlLower = row.sql_text.trim().toLowerCase();
        if (sqlLower.startsWith('select')) sqlType = 'SELECT';
        else if (sqlLower.startsWith('insert')) sqlType = 'INSERT';
        else if (sqlLower.startsWith('update')) sqlType = 'UPDATE';
        else if (sqlLower.startsWith('delete')) sqlType = 'DELETE';

        const record = {
          id: row.event_id,
          threadId: row.thread_id,
          type: sqlType,
          sql: row.sql_text.trim(),
          duration: duration,
          timestamp: now,
          schema: row.current_schema
        };

        const typeMatch = configType === 'ALL' || record.type === configType;
        const durationMatch = record.duration >= configDuration;

        if (typeMatch && durationMatch) {
          processedEventIds.add(row.event_id);
          newEvents.push(record);
          if (row.timer_end > lastTimerEnd) {
            lastTimerEnd = row.timer_end;
          }
        }
      }
    });

    if (newEvents.length > 0) {
      sqlData.push(...newEvents);

      if (sqlData.length >= SAVE_THRESHOLD) {
        console.log(`达到阈值 ${SAVE_THRESHOLD} 条记录，自动保存文件...`);
        const fileName = saveToFile(sqlData, true);
        console.log(`已保存到 ${fileName}`);
        sqlData = [];
        processedEventIds.clear();
        lastTimerEnd = 0;
      }
    }

  } catch (err) {
    console.error('获取SQL数据失败:', err.message);

    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
      console.log('数据库连接已断开，停止监控...');
      monitoring = false;
      if (fetchIntervalId) {
        clearInterval(fetchIntervalId);
        fetchIntervalId = null;
      }
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('数据库访问被拒绝');
      monitoring = false;
      if (fetchIntervalId) {
        clearInterval(fetchIntervalId);
        fetchIntervalId = null;
      }
    }
  }
}

function saveToFile(dataToSave = sqlData, isAutoSave = false) {
  if (dataToSave.length === 0) return;

  try {
    let fileName;
    if (isAutoSave) {
      fileName = `sql_log_${fileCounter}.txt`;
    } else {
      fileName = `sql_monitor_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.txt`;
    }

    const fullPath = path.join(savePath, fileName);

    let content = 'SQL 监控记录\n';
    content += '='.repeat(80) + '\n\n';
    content += `生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
    content += `记录数量: ${dataToSave.length}\n`;
    content += `保存路径: ${fullPath}\n`;
    content += '='.repeat(80) + '\n\n';

    dataToSave.forEach((record, index) => {
      content += `${index + 1}. [${new Date(record.timestamp).toLocaleString('zh-CN')}]\n`;
      content += `类型: ${record.type}\n`;
      content += `执行时间: ${record.duration.toFixed(3)}秒\n`;
      content += `线程ID: ${record.threadId}\n`;
      content += `SQL: ${record.sql}\n`;
      if (record.schema) content += `数据库: ${record.schema}\n`;
      content += '-'.repeat(80) + '\n\n';
    });

    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf8');

    if (isAutoSave) {
      fileCounter++;
    }

    return fileName;
  } catch (err) {
    console.error('保存文件失败:', err.message);
    throw err;
  }
}

app.post('/api/connect', async (req, res) => {
  try {
    dbConfig = req.body;
    await testConnection(dbConfig);
    connection = createConnection(dbConfig);
    connection.connect(err => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }
      res.json({ success: true, message: '连接成功' });
    });
  } catch (err) {
    console.error('连接数据库失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/start', async (req, res) => {
  try {
    if (!connection) {
      return res.json({ success: false, message: '请先连接数据库' });
    }

    const { duration, type, savePath: customPath } = req.body;
    configDuration = duration;
    configType = type;

    if (customPath) {
      savePath = customPath;
      if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath, { recursive: true });
      }
    }

    if (fetchIntervalId) {
      clearInterval(fetchIntervalId);
    }

    monitoring = true;
    sqlData = [];
    processedEventIds.clear();
    lastTimerEnd = 0;
    fileCounter = 1;

    res.json({ success: true, message: '监控已启动' });

    fetchIntervalId = setInterval(() => {
      if (!monitoring) {
        clearInterval(fetchIntervalId);
        fetchIntervalId = null;
        return;
      }
      fetchSQLData();
    }, 500);

  } catch (err) {
    console.error('启动监控失败:', err);
    res.json({ success: false, message: '启动监控失败: ' + err.message });
  }
});

app.post('/api/stop', (req, res) => {
  try {
    monitoring = false;

    if (fetchIntervalId) {
      clearInterval(fetchIntervalId);
      fetchIntervalId = null;
    }

    let fileName;
    let recordCount = 0;
    try {
      recordCount = sqlData.length;
      fileName = saveToFile();
    } catch (saveErr) {
      console.error('保存文件失败:', saveErr);
      return res.json({
        success: true,
        message: '监控已停止，但保存文件失败: ' + saveErr.message,
        fileName: null,
        recordCount: recordCount
      });
    }

    res.json({
      success: true,
      message: '监控已停止',
      fileName: fileName || null,
      recordCount: recordCount
    });
  } catch (err) {
    console.error('停止监控失败:', err);
    res.json({
      success: false,
      message: '停止监控失败: ' + err.message
    });
  }
});

app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(savePath)) {
      return res.json({ success: true, files: [] });
    }

    const files = fs.readdirSync(savePath)
      .filter(file => file.startsWith('sql_log_') && file.endsWith('.txt'))
      .map(file => {
        const stats = fs.statSync(path.join(savePath, file));
        return {
          name: file,
          path: path.join(savePath, file),
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
        };
      })
      .sort((a, b) => {
        const numA = parseInt(a.name.match(/sql_log_(\d+)\.txt/)[1]);
        const numB = parseInt(b.name.match(/sql_log_(\d+)\.txt/)[1]);
        return numB - numA;
      });

    res.json({ success: true, files });
  } catch (err) {
    console.error('获取日志文件列表失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/logs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(savePath, filename);

    if (!fs.existsSync(filePath)) {
      return res.json({ success: false, message: '文件不存在' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, filename, content });
  } catch (err) {
    console.error('读取日志文件失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/queryInboundSql', (req, res) => {
  try {
    const { orderNo } = req.body;
    console.log('收到入库单号查询请求:', orderNo);

    res.json({
      success: false,
      message: '接口已预留，功能未实现',
      orderNo: orderNo
    });
  } catch (err) {
    console.error('查询入库单SQL失败:', err);
    res.json({
      success: false,
      message: err.message
    });
  }
});

app.get('/api/monitor/status', (req, res) => {
  try {
    res.json({
      success: true,
      monitoring,
      count: sqlData.length,
      config: dbConfig ? { host: dbConfig.host, port: dbConfig.port, user: dbConfig.user } : null
    });
  } catch (err) {
    console.error('获取状态失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/data', (req, res) => {
  try {
    res.json({ success: true, data: sqlData });
  } catch (err) {
    console.error('获取数据失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/stream', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendData = () => {
      if (!monitoring) return;
      try {
        res.write(`data: ${JSON.stringify(sqlData)}\n\n`);
      } catch (err) {
        console.error('SSE发送数据失败:', err);
      }
    };

    const interval = setInterval(sendData, 1000);

    req.on('close', () => {
      clearInterval(interval);
      try {
        res.end();
      } catch (err) {
        console.error('关闭SSE连接失败:', err);
      }
    });

    sendData();
  } catch (err) {
    console.error('SSE流错误:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: '流式传输失败' });
    }
  }
});

app.get('/api/clear', (req, res) => {
  try {
    sqlData = [];
    processedEventIds.clear();
    lastTimerEnd = 0;
    res.json({ success: true });
  } catch (err) {
    console.error('清空数据失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/databases', async (req, res) => {
  try {
    if (!connection) {
      return res.json({ success: false, message: '请先连接数据库' });
    }

    const [rows] = await connection.promise().query(`
      SHOW DATABASES
    `);

    const databases = rows
      .map(row => Object.values(row)[0])
      .filter(name => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name));

    res.json({ success: true, databases });
  } catch (err) {
    console.error('获取数据库列表失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/databases/:name/tables', async (req, res) => {
  try {
    if (!connection) {
      return res.json({ success: false, message: '请先连接数据库' });
    }

    const dbName = req.params.name;
    const [rows] = await connection.promise().query(`
      SHOW TABLES FROM ${mysql.escapeId(dbName)}
    `);

    const tables = rows.map(row => Object.values(row)[0]);

    res.json({ success: true, tables });
  } catch (err) {
    console.error('获取表列表失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  try {
    monitoring = false;

    if (fetchIntervalId) {
      clearInterval(fetchIntervalId);
      fetchIntervalId = null;
    }

    if (connection) {
      try {
        connection.end();
      } catch (connErr) {
        console.error('关闭数据库连接失败:', connErr);
      }
      connection = null;
    }

    res.json({ success: true, message: '已断开连接' });
  } catch (err) {
    console.error('断开连接失败:', err);
    res.json({ success: false, message: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error('全局错误捕获:', err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎯 SQL 监控系统已启动`);
  console.log(`📍 监听端口: ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`\n📋 系统信息:`);
  console.log(`   - 监控间隔: 1秒`);
  console.log(`   - 数据源: performance_schema`);
  console.log(`   - 数据存储: TXT 文件`);
  console.log(`\n🚀 功能特性:`);
  console.log(`   - 实时 SSE 推送`);
  console.log(`   - SQL 类型筛选`);
  console.log(`   - 执行时间筛选`);
  console.log(`   - 自动数据持久化`);
  console.log(`   - 无侵入性能监控`);
  console.log(`\n👨‍💻 使用说明:`);
  console.log(`   1. 启动系统`);
  console.log(`   2. 在浏览器中打开访问地址`);
  console.log(`   3. 输入数据库连接信息`);
  console.log(`   4. 设置筛选条件并开始监控`);
  console.log(`   5. 监控结束后自动保存到 TXT 文件`);
  console.log(`\n📁 默认保存路径: 项目根目录`);
  console.log(`\n✅ 系统就绪！`);
});
