# MyLike · 移动端回看测试

用户已在 iPhone 跑通桌面清单导出、导入、竖滑回看、静态图集、续播和实况试播。当前版新增按发布时间筛选和直接随机播放，并调整封面滚动和播放缓冲反馈。

同一套 Expo 工程支持 iOS 和 Android。Android 已接入系统导入菜单和返回操作，待真机验收。

首版范围见 [PRD.md](PRD.md)，文件结构见 [清单契约](LIBRARY_FORMAT.md)。

## 准备清单

- 桌面测试版：「喜欢 → 导出清单」。导出当前账号已经保存的全部喜欢，不受筛选和批选影响。Windows 测试程序位于 `electron/apps/desktop/dist/mobile-export-test/win-unpacked/MyLike.exe`。
- 没有桌面清单时，可先把 [公开测试清单](examples/public-sample.mylike.json) 保存到手机的「文件」或「下载」，用于验证导入、去重和点播。

若想用正式版现有内容验收，在正式版「设置 → 数据与存储」记下实际数据目录并退出正式版，再在一个新的 PowerShell 窗口运行：

```powershell
$env:MYLIKE_USER_DATA = '这里替换成正式版的数据目录'
& 'D:\douyin-favorite-MyLike\electron\apps\desktop\dist\mobile-export-test\win-unpacked\MyLike.exe'
```

测试程序不需要安装。测试时不要同时运行两个桌面版本；如果希望隔离真实库，可用现有备份复制到一个新的测试目录并命名为 `mylike.sqlite`，再把环境变量指向测试目录。

## 在 iPhone 上打开

1. 在 iPhone 的 App Store 安装或更新 [Expo Go](https://apps.apple.com/cn/app/expo-go/id982107779)，使用支持 SDK 58 的版本。让 iPhone 和电脑连到同一个 Wi-Fi。
2. 在本目录打开 PowerShell，依次运行以下命令。如果本机依赖已经安装，可以跳过 `npm.cmd ci`。如果电脑终端已登录 Expo，也可跳过第二行。

   ```powershell
   npm.cmd ci
   npx.cmd expo login
   npm.cmd start
   ```

3. 在 Expo Go 登录和电脑相同的 Expo 账号，然后用 iPhone 相机扫终端二维码。首次出现「本地网络」权限提示时允许访问。开发服务器要保持运行。
4. 有已导入的作品可以直接使用。导入新清单时，从内容库右上角菜单选「导入清单」，打开 JSON，核对来源、条数和重复数，再点「合并导入」。重新导入同一份文件应显示新增 0 条。

Expo 登录仅用于打开开发项目，不需要付费 Apple 开发者账号，也不需要登录抖音。如果扫码连不到电脑，先确认两台设备在同一 Wi-Fi、iPhone 已允许 Expo Go 访问本地网络，以及 Windows 防火墙允许 Node.js 在当前专用网络上监听。

如果 `expo login` 在 Windows 自动打开浏览器时退出，可以在当前 PowerShell 运行 `$env:BROWSER = 'none'`，再运行 `npx.cmd expo login`。保持终端运行，用电脑浏览器打开这次新打印的完整链接。登录完成后用 `npx.cmd expo whoami` 确认账号，再启动 Metro。如果你使用 Expo 用户名和密码，也可运行 `npx.cmd expo login --no-browser`，按提示在终端输入。

## 在 Android 上用 Expo Go 调试

1. 在 Android 手机安装支持 SDK 58 的 [Expo Go](https://expo.dev/go)，将手机和电脑连到同一个 Wi-Fi。
2. 在 Windows 按上面的命令启动开发服务器，在 Android 的 Expo Go 内扫终端二维码。若提示账号不匹配，在手机和 CLI 登录同一个 Expo 账号。
3. 在内容库右上菜单选择「导入清单」，从手机文件选择器打开 JSON。进入回看后用系统返回手势或返回键回到内容库，并确认播放停止。

## 在 Android 上安装独立测试包

1. 在 GitHub 打开 **Actions → Build Android test APK → Run workflow**。完成后从 **Artifacts** 下载 `MyLike-android-test-…`，解压得到 `MyLike-android-test.apk`。
2. 在雷电等模拟器里用侧栏的「安装 APK」选择解压出的文件。若要测试和手机相近的下载流程，可把 APK 放到模拟器的「下载」目录，从 Android 文件管理器打开，按系统提示允许安装。优先用 Android 9 或更新的模拟器实例。
3. 从 Android 主屏幕打开 MyLike，导入同一份清单，再按下方清单验证播放和续播。独立包内已包含 JS，无需运行 Metro 或 Expo Go。

这个 Release 测试包使用 Expo 模板的调试证书。正式发布前要换发布证书。Android 只允许相同签名的包直接覆盖升级，测试库需要保留时可保存原始 JSON 以便重导。

## 真机验收

1. 冷启动应显示内容库，即使已有观看记录也一样。内容库右滑进入回看并恢复上次进度，普通视频左滑返回内容库。图集内左右滑翻页，从屏幕右边缘向左滑返回内容库。返回后确认已提交的搜索条件和滚动位置仍在。
2. 在内容库输入搜索词，确认列表仍保持原结果，按键盘「搜索」后再更新。点开一条并缓慢上下拖动，相邻页应和当前页一起跟手。短拖后吸附回原位，完整滑动后换条。下一条从预览切到播放时应连续出画并自动播放，切换过程中只听到当前作品。分别测试观看几秒后上滑与连续快速上滑。
3. 视频默认单条循环。轻点画面暂停时，中央显示播放三角。横拖画面底部的进度区时，细线和目标时间出现，松手跳转并继续播放。暂停后退出并重开项目，从内容库右滑，确认回到同一作品和进度。
4. 长按画面中间打开播放选项。分别测试自动连播、倍速、队列和清屏。长按画面左右两侧以 2 倍速播放普通视频或当前实况片段，松手恢复原倍速和播放状态。清屏后再次长按中间可退出清屏。
5. 打开有配乐的图集，确认音乐在左右翻页时继续，点按可暂停或继续。上下滑换作品或切回内容库时，上一条的配乐应停止。退出并重开项目，确认恢复同一页。
6. 正常刷到实况图集时，当前页片段应自动播放。左右翻页时只剩当前页片段，换作品后原声和配乐都应停止。内容库三列网格显示封面和右上角类型标记。
7. 点「不限日期」，选年份，再选「全年」或某月。可用年月随已提交的搜索和类型更新，时间边界使用北京时间。点「随机播放」后，长按中间打开队列，确认作品都来自当前结果、同一轮没有重复。播放面板的「随机播放」或「重新随机」会打乱这批队列。

## 实况片段试播

1. 从已有清单打开一条实况图集，长按画面中间选「实况试播」。顶部会显示本页取得的片段地址数。
2. 先看静态图，再点按画面试播。App 会暂存当前片段到缓存后播放，顶部显示「已显示首帧」和推进的时间。片段播完回到静态图，可以点按重播。试播期间暂停图集配乐，以便辨认片段自己的声音。
3. 趁片段播放时左右滑到下一页，确认上一张立刻停止。下一页需要点按才会播。若要测串音，至少选一张显示有音轨且能听到声音的片段。
4. 本页未取得片段时继续显示静态图。片段地址失败时会尝试备用地址；若仍失败，可以长按选「重新取链」。测试结束后长按选「退出实况试播」。

## 游客取链诊断

内容库为空时，可打开「测试公开样例」运行独立诊断。

- **取链失败**：看诊断里的「短链」或「详情」结果。短链无法展开时可改用作品长链接或 ID；HTTP 200 但没有作品数据也属于取链失败。
- **取链成功、没有画面**：可以点「换备用地址」。诊断会区分播放器报错、等不到首帧和播放进度已推进。
- 可以用「分享诊断」复制本次记录，记录不包含完整媒体地址。

详情接口参考 [short_videos 的实现](https://github.com/jiuhunwl/short_videos/blob/main/api/douyin/DouyinParser.php)：`api.amemv.com/aweme/v1/aweme/detail/`。它和无印字节签名访问的网页接口是两条不同的路线。此测试不发送登录 Cookie、不签名、不通过电脑代理；电脑只给 Expo Go 提供 App 代码。

## 从 GitHub 构建独立 iPhone 测试包

### 建仓和首次提交

在 [GitHub 新建仓库](https://github.com/new)，名字可用 `mylike-mobile`，同时托管 iOS 和 Android。个人验收可先用私有仓库。保持远端仓库为空，README、.gitignore 和许可证在创建时留空。本地目录已有项目文件。

在 Windows PowerShell 中进入移动端目录，把远端 URL 换成自己新建仓库的 HTTPS 地址。

```powershell
Set-Location 'D:\douyin-favorite-MyLike\react native'
git init -b main
git add .
git status --short
git commit -m "Initial MyLike mobile app"
git remote add origin https://github.com/你的账号/mylike-mobile.git
git push -u origin main
```

暂存清单应包含源码、`package-lock.json`、公开测试样例和 `.github/workflows/ios-ipa.yml`。个人喜欢清单留在项目目录之外。

### 构建和下载

1. 打开新仓库的 **Actions → Build iPhone test IPA → Run workflow**，选择 `main`。
2. 工作流用 macOS runner 生成 iOS 项目、编译 ARM64 Release，并验证包内存在独立 JS bundle。构建完成后，在该运行的 **Artifacts** 下载 `MyLike-ios-unsigned-…`。
3. 解压下载的 ZIP，得到 `MyLike-ios-unsigned.ipa` 和 SHA-256 校验文件。若需核对，可用 `Get-FileHash .\MyLike-ios-unsigned.ipa -Algorithm SHA256`。私有仓库的下载账号需要读取权限，测试 artifact 保留 7 天。

### Windows 签名和 iPhone 验收

1. 按 [Sideloadly 官方安装说明](https://sideloadly.io/)准备 Windows 端。用 USB 连接 iPhone，解锁并确认信任电脑。
2. 将解压得到的 IPA 放入 Sideloadly，选择该 iPhone，使用自己的 Apple ID 签名和安装。在 iPhone 按提示启用「设置 → 隐私与安全性 → 开发者模式」，重启并确认。若系统提示信任签名账号，在「设置 → 通用 → VPN 与设备管理」完成。
3. 停掉 Metro，拔掉 USB，让 iPhone 保持联网，从主屏幕打开 **MyLike**。独立包的内容库独立于 Expo Go，先重新导入 JSON，再验收普通视频、静态图集、实况、年月筛选、随机队列和退出后续播。
4. 免费 Apple ID 的开发签名一般需要每 7 天续签。下次覆盖安装时保持相同的 Apple ID 和有效 Bundle ID，并在真机核对内容库及观看进度。

GitHub 负责生成未签名测试包，Apple ID 与设备签名在 Windows 上完成。[GitHub artifact 下载说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts) · [Sideloadly FAQ](https://sideloadly.io/faq) · [Apple 开发者模式说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/)

本地检查：`npm.cmd test`、`npm.cmd run typecheck`、`npx.cmd expo export --platform ios`。
