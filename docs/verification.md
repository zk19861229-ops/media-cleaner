# 验证记录 · 2026-09-29

新增 Web 扩展：74 项 Node 测试、语法检查及静态构建通过；浏览器启动被环境阻塞，未完成运行验收。详细记录见 [Web 验证](web-verification.md)。下文保留 Android 验证结果。

## 已通过

- JDK 17 / Kotlin 2.0.21 编译核心模块与测试。
- **35 项 JUnit 测试通过**：32 项策略、计划及执行器安全测试；3 项使用新建临时 PNG 文件的真实文件系统集成测试。
- 编译所有 Android Kotlin 源码，启用 Compose 和 Kotlin Serialization 编译插件。
- Android 官方 Manifest Merger 合并主应用和依赖清单。
- AAPT2 完成依赖/应用资源编译、链接与 R 类生成。
- D8 完成 Android DEX 编译。协程依赖有两条局部变量调试信息修正提示，未影响编译完成。
- 调试 APK 生成，apksigner 验证 v2/v3 签名通过，zipalign 对齐检查通过。
- APK 元数据检查：包名 `cn.spacekeeper.app`，版本 `0.1.0`，minSdk 26，targetSdk 35，启动页 `MainActivity`。
- 生成独立合成图片与视频样本；未扫描、修改或删除用户个人媒体。

测试保护的行为包括：没有完整哈希不能判定完全重复、受保护文件不被删除、相似项默认不选、保留副本不成为删除目标、组外模型 ID 被拒绝、错误/非有限置信度被拒绝、确认绑定版本/内容摘要、授权失效和文件变更导致跳过、重复执行不重复删除、不确定结果不计入释放空间。

## 环境限制与未验证项

- 常规 Gradle 构建在启动守护进程时失败：`java.net.SocketException: Operation not permitted`，来自当前执行环境的本地监听端口限制。因此未完成 Gradle `assembleDebug`、Gradle 单元测试任务和 Android lint；使用了项目内可复现的独立编译、测试及打包脚本。
- **没有完成真机或模拟器安装、界面交互、系统 SAF 授权及 Android 文件删除实测。** APK 构建/签名通过不代表这些运行行为已经验证。按 `device-acceptance.md` 用合成样本验收后再处理个人内容。
- Jev 官方 API/SDK 和可用凭证未提供。已实现本项目网关契约和客户端适配，未完成真实 Jev/LLM 联调。默认本地规则模式。
- 未验证万级媒体的耗时、内存峰值、电量和相似候选误报；不引用供应商性能数字作为应用指标。
- Android SAF 无法与其他应用形成原子“检查并删除”事务。执行器重读内容并在删除前检查元数据，但不能消除其他应用并发改写的所有竞态。

## 复现

```sh
JAVA_HOME=/path/to/jdk17 python3 scripts/check-core.py
JAVA_HOME=/path/to/jdk17 ANDROID_HOME=/path/to/android-sdk python3 scripts/build-standalone.py
```

正常 Android 开发环境还应执行：

```sh
./gradlew :core:test :app:assembleDebug :app:lintDebug
```

本版本可用于代码评审和合成数据验收。压缩、iOS、后台定时扫描与供应商正式接入未作为已完成能力交付。
