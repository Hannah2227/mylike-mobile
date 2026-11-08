# MyLike 移动端

MyLike 是 iOS 和 Android 上的抖音喜欢回看工具。把桌面端导出的喜欢清单导入手机，就能按标题、作者、类型和年月查找作品，也可以顺序或随机回看视频、图集和实况图集。

清单和播放进度保存在设备上。播放时需要联网，手机会按作品 ID 获取可用的媒体地址，无需登录抖音。作品失效或接口受限时，可以重试或跳过。

## 安装

正式安装包以 [GitHub Releases](https://github.com/Hannah2227/mylike-mobile/releases) 为准。目前的 Actions 产物用于测试。

- **Android**：下载 APK 并打开，按系统提示完成安装。测试 APK 使用测试证书，正式包若使用不同签名，需要卸载测试包再安装。卸载会清除手机里的内容库和进度，请保留原始清单。
- **iPhone**：测试 IPA 需要先在电脑上签名，再安装到手机。Windows 上可使用 Sideloadly，按 iPhone 提示启用开发者模式。免费 Apple 账号签名需要定期续签。 [Sideloadly 安装说明](https://sideloadly.io/) · [Apple 开发者模式说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)

## 导入与回看

1. 使用带有「导出清单」入口的 [MyLike 桌面版](https://github.com/Hannah2227/douyin-favorite-MyLike)，在「喜欢」页导出 JSON。该入口目前只在桌面测试版中验证。可以先用 [公开样例](examples/public-sample.mylike.json) 体验导入和回看。
2. 将 JSON 保存到手机的「文件」或「下载」。打开 MyLike，从内容库选择「导入清单」，核对预览后点「合并导入」。重复导入会按作品 ID 合并。
3. 点开封面开始回看，上下滑切换作品，图集内左右滑翻页。长按屏幕中间可调倍速、切换连播、清屏或查看队列。回到内容库后，向右滑可恢复上次的作品与进度。

[清单格式说明](LIBRARY_FORMAT.md)

## 开发与构建

项目使用 React Native 和 Expo SDK 58，构建工作流使用 Node.js 24.12.0。

```sh
npm ci
npm run typecheck
npm test
npm start
```

使用支持 SDK 58 的 [Expo Go](https://expo.dev/go) 调试。维护者可在 GitHub Actions 手动运行 **Build Android test APK** 或 **Build iPhone test IPA**，在成功运行的 Artifacts 区下载独立测试包和 SHA-256 校验文件。

播放交互参考 [zyronon/douyin](https://github.com/zyronon/douyin)，游客取链参考 [short_videos](https://github.com/jiuhunwl/short_videos/blob/main/api/douyin/DouyinParser.php)。
