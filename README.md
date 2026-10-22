# 拾光清理 · Space Keeper

Android 与 Web 图片视频清理应用。选择并授权本地目录后，自动分析媒体，形成可以预览和调整的清理计划；用户确认后才执行永久删除。

调试安装包：[`output/spacekeeper-debug.apk`](output/spacekeeper-debug.apk)。已完成独立 SDK 构建和签名校验，**尚未完成手机安装与运行验收**。

Web 静态包：[`output/spacekeeper-web.zip`](output/spacekeeper-web.zip)。支持桌面 Chromium 目录授权清理；缺少目录写入能力的浏览器使用只读分析与导出。见 [Web 使用说明](web/README.md) 和 [Web 验证记录](docs/web-verification.md)。

```sh
cd web
npm ci
npm run dev
# 访问 http://127.0.0.1:4173
```

## 已实现的源码能力

- Android 系统目录授权及持久访问权限；递归扫描子目录，仅支持本地外部存储 DocumentsProvider。
- 完整 SHA-256 图片/视频去重；视频先按大小筛选，图片提取 dHash 和清晰度特征。
- 相似图片直接与保留锚点比较，避免把相似关系当成传递关系；相似项默认不选中。
- 查看媒体、逐项勾选、改选保留副本、整组保留、保护文件、按文件名保护截图、浏览大视频。
- SQLite 存储 Ontology 对象、证据、关系、版本化清理计划、批准记录和执行日志。
- 执行前重新检查内容指纹、目录权限和保留副本；中断恢复不把不确定结果计入已释放容量。
- LLM 策略与 Jev 决策的 HTTPS 网关适配接口；默认使用明确标识的本地规则，不伪装真实模型推理。

## 构建与运行

使用 Android Studio 打开本目录，安装 JDK 17、Android SDK Platform 35 和 Build Tools，连接 Android 8.0+ 设备。Gradle Wrapper 固定到 8.9，附官方分发文件 SHA-256 校验。

```sh
./gradlew :core:test :app:assembleDebug :app:lintDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

在设备中：选择一个专门的测试目录 → 开始分析 → 查看保留副本与候选项 → 查看并确认清理 → 确认永久删除。先用测试数据验收；该应用没有回收站。

纯核心测试不需要 Android SDK，也可以不用 Gradle：

```sh
JAVA_HOME=/path/to/jdk17 python3 scripts/check-core.py
```

脚本首次运行会通过 curl 下载 Maven Central 依赖至 `.tools/`。环境不允许网络时可提前缓存相同版本的依赖，或设置 `SPACEKEEPER_TOOLS` 指向缓存根目录。

如果环境禁止 Gradle 后台服务所需的监听端口，可使用独立 SDK 构建脚本。它使用 Kotlin 2.0.21、Android 官方 Manifest Merger、AAPT2、D8、zipalign 和 apksigner，以及明确列出的依赖快照；不能替代 Gradle lint 或设备验收：

```sh
JAVA_HOME=/path/to/jdk17 ANDROID_HOME=/path/to/android-sdk \
  python3 scripts/build-standalone.py
```

需要 SDK Platform 35、Build Tools 35.0.0 和 `cmdline-tools/latest`。产物是采用本地调试密钥签名的 APK，不是应用商店发布包。

## 项目结构

```text
core/       Kotlin 类型本体、分组、计划、规则、执行状态机和安全测试
app/        Compose 界面、SAF 访问、媒体分析、SQLite、模型网关
web/        浏览器界面、File System Access、Worker、IndexedDB、静态构建及测试
docs/       执行章程、模型契约、设备验收与验证记录
scripts/    独立核心测试和合成验收样本工具
```

LLM 理解用户偏好；Jev 提供结构化建议；Ontology 保存对象/关系并支撑约束；删除由确定性执行器完成。网络模型不能直接访问文件接口。详见 [网关契约](docs/model-gateway.md) 与 [项目章程](docs/project-charter.md)。

## 版本边界

当前版本为可评审的首版实现。真实 Jev SDK/API 未提供，不能声称已完成官方 Jev 集成。原始媒体不会发往模型端；启用网关后发送用户主动输入的偏好及匿名尺寸/清晰度/保护状态。

不支持：iOS 原生应用、其他应用私有目录、云盘、视频视觉相似识别、媒体压缩、自动后台调度、回收站。截图保护依赖文件名，不代表 OCR 分类。图片相似度与清晰度只是筛选提示，不能判断个人价值。

扫描时请保持应用打开；暂停后重新遍历目录并复用未变化文件缓存。系统关闭进程后，已批准但未完成的计划可手动继续。SAF 不提供“比对并删除”的跨应用原子操作，执行前多次验证能降低竞态风险，但无法锁住其他应用的并发写入；验收时不要让其他应用同步修改测试目录。

删除容量显示为成功删除文件的逻辑大小；不等同于设备可用空间净变化。具体构建与运行验证状态见 [验证记录](docs/verification.md)。
