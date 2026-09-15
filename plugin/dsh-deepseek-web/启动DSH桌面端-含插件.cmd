@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem dsh-deepseek-web -- 打包桌面模式启动器（2026-09 调整）
rem DeepSeek Harness 现在是打包桌面应用。插件通过桌面 profile 装配
rem 加载（用 DSH++ 面板把本插件导入到 desktop profile 即可生效），
rem 不再需要 dev 模式 pnpm run start:desktop 重建一次性项目 + 注入。
rem 本脚本已停用 dev 拉起链路，避免再弹 cmd 黑窗。
rem 需要启动 DSH：请用打包版 exe / 托盘 / DSH++ 面板，不要用本脚本。
rem ============================================================
echo [dsh-deepseek-web] 已切换为打包桌面模式，dev 启动器已停用。
echo 请用 DSH++ 面板把本插件导入到 desktop profile，再启动打包版 DSH。
exit /b 0
endlocal