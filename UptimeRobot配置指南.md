# UptimeRobot配置指南 - 解决Render休眠问题

## 🎯 问题分析
**Render免费版限制**：
- 15分钟无访问会自动休眠
- 休眠后首次访问需要30秒冷启动
- 影响用户体验

**解决方案**：
- 使用UptimeRobot每10分钟ping一次健康检查端点
- 保持服务活跃状态
- 完全免费

## 📋 配置步骤

### 第一步：添加健康检查端点

#### 1.1 在后端添加健康检查
```python
# app/main.py 添加以下代码
from datetime import datetime
from fastapi import FastAPI

@app.get("/health")
async def health_check():
    """健康检查端点，用于UptimeRobot监控"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "aigc-copyright-api"
    }

@app.get("/api/health")  # 备用端点
async def health_check_api():
    return {"status": "ok", "timestamp": datetime.now()}
```

#### 1.2 测试健康检查端点
```bash
# 本地测试
curl http://localhost:8000/health

# 部署后测试
curl https://your-app.onrender.com/health
```

### 第二步：注册UptimeRobot

#### 2.1 访问官网
```
https://uptimerobot.com/
```

#### 2.2 注册账号
1. 点击 "Sign Up" 
2. 使用邮箱注册（免费）
3. 验证邮箱登录

### 第三步：创建监控任务

#### 3.1 添加新监控
1. 登录后点击 "Add New Monitor"
2. 选择监控类型：**HTTP(s)**
3. 填写信息：
   ```
   Monitor Type: HTTP(s)
   Friendly Name: AIGC API Health Check
   URL (or IP): https://your-app.onrender.com/health
   Monitoring Interval: 10 minutes
   ```
4. 点击 "Create Monitor"

#### 3.2 监控设置详解
```
📋 基本信息
- Friendly Name: AIGC API Health Check (便于识别)
- URL: https://api.yourdomain.com/health (用你的实际域名)

⏰ 监控频率
- Monitoring Interval: 10 minutes (推荐)
- 不要选择1分钟或5分钟(可能被限制)

🔔 通知设置
- Email: 你的邮箱(默认开启)
- 可以添加微信、钉钉等通知
```

### 第四步：高级配置

#### 4.1 配置监控选项
```bash
# 在Monitor Settings中配置：
- Check HTTP redirects: ON
- Timeout: 15 seconds
- HTTP Method: GET
- HTTP Status Codes: 200-299
```

#### 4.2 设置联系人
```bash
# Contacts页面可以添加：
1. 邮箱通知(默认)
2. 微信通知(需配置)
3. 钉钉通知(需配置)
4. Slack通知(需配置)
```

#### 4.3 维护窗口设置
```bash
# 如果有维护时间，可以设置：
- Maintenance Windows: 设置维护时段
- 在维护期间不会发送告警
```

### 第五步：创建多个监控点

#### 5.1 主监控
```
Name: AIGC API - Main
URL: https://api.yourdomain.com/health
Interval: 10 minutes
```

#### 5.2 备用监控
```
Name: AIGC API - Backup  
URL: https://your-app.onrender.com/api/health
Interval: 15 minutes
```

#### 5.3 关键端点监控
```
Name: AIGC API - Auth Check
URL: https://api.yourdomain.com/api/health
Interval: 30 minutes
```

## 🔧 配置示例

### 完整的监控配置
```json
{
  "monitors": [
    {
      "name": "AIGC API Health",
      "url": "https://api.yourdomain.com/health",
      "interval": 10,
      "timeout": 15,
      "status_codes": "200-299"
    },
    {
      "name": "AIGC API Backup", 
      "url": "https://your-app.onrender.com/health",
      "interval": 15,
      "timeout": 15,
      "status_codes": "200-299"
    }
  ]
}
```

### 健康检查端点代码
```python
# app/api/endpoints/health.py
from fastapi import APIRouter, HTTPException
from datetime import datetime
import asyncio
from app.core.config import settings

router = APIRouter()

@router.get("/health")
async def health_check():
    """详细健康检查"""
    try:
        # 检查数据库连接
        # 这里可以添加数据库连接检查
        
        # 检查关键服务状态
        status = {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "service": "aigc-copyright-api",
            "version": "1.0.0",
            "environment": "production" if settings.PRODUCTION else "development"
        }
        
        return status
        
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unavailable: {str(e)}")

@router.get("/health/simple")
async def simple_health():
    """简单健康检查，用于UptimeRobot"""
    return {"status": "ok", "timestamp": datetime.now()}
```

## 📊 监控效果

### 配置成功后的效果
```
✅ 每10分钟自动ping一次
✅ 服务保持活跃状态
✅ 用户访问无延迟
✅ 及时收到故障告警
```

### UptimeRobot仪表板
```
📈 可用性统计: 99.9%+
⏰ 响应时间: 通常<500ms
📱 故障告警: 邮件/微信通知
📊 历史数据: 30天+监控历史
```

## 🛠️ 故障排查

### 常见问题
1. **监控失败**
   ```
   检查URL是否正确
   确认健康检查端点可访问
   验证SSL证书有效
   ```

2. **告警过于频繁**
   ```
   调整监控间隔到15分钟
   检查服务稳定性
   优化健康检查逻辑
   ```

3. **服务仍然休眠**
   ```
   确认UptimeRobot正常运行
   检查监控日志
   可能需要增加监控频率
   ```

### 调试命令
```bash
# 手动测试健康检查
curl -I https://api.yourdomain.com/health

# 查看响应时间
curl -w "@curl-format.txt" -o /dev/null -s https://api.yourdomain.com/health

# 持续监控
while true; do curl -s https://api.yourdomain.com/health | jq .; sleep 300; done
```

## 🔄 备用方案

### 如果UptimeRobot失效
1. **使用其他免费监控服务**
   ```
   - Pingdom (免费版)
   - StatusCake (免费版)
   - Freshping (免费版)
   ```

2. **自建监控脚本**
   ```python
   # 可以部署到Vercel Serverless Function
   import httpx
   import asyncio

   async def keep_alive():
       while True:
           try:
               async with httpx.AsyncClient() as client:
                   response = await client.get("https://api.yourdomain.com/health")
                   print(f"Ping successful: {response.status_code}")
           except Exception as e:
               print(f"Ping failed: {e}")
           
           await asyncio.sleep(600)  # 10分钟

   # 在Vercel中设置定时任务
   ```

3. **使用GitHub Actions**
   ```yaml
   # .github/workflows/keep-alive.yml
   name: Keep API Alive
   
   on:
     schedule:
       - cron: '*/10 * * * *'  # 每10分钟
   
   jobs:
     keep-alive:
       runs-on: ubuntu-latest
       steps:
         - name: Ping API
           run: |
             curl -f https://api.yourdomain.com/health
   ```

## 📈 监控最佳实践

### 1. 监控策略
```
🎯 核心端点: 每10分钟监控
📊 性能端点: 每30分钟监控  
🔧 管理端点: 每1小时监控
```

### 2. 告警配置
```
📧 立即告警: 服务完全不可用
⏰ 延迟告警: 响应时间>2秒
📱 多渠道: 邮件+微信+钉钉
```

### 3. 数据分析
```
📈 定期查看可用性报告
📊 分析响应时间趋势
🔍 找出性能瓶颈
```

---

## 🎉 配置完成

配置完成后，你的Render服务将：
- ✅ **永不休眠**：每10分钟保持活跃
- ✅ **用户无感知**：访问即响应，无冷启动
- ✅ **故障及时知**：服务异常立即收到通知
- ✅ **完全免费**：UptimeRobot免费版足够使用

**现在就开始配置吧！只需要5分钟就能解决休眠问题。**
