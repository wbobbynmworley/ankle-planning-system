# PDF 中文字体

生成 PDF 报告时需要中文字体，否则会出现乱码。

## 方式一：使用本目录（推荐）

将系统里的中文字体复制到本目录下，任选其一即可：

- **Windows**：从 `C:\Windows\Fonts\` 复制以下任一文件到本目录并改名为 `simsun.ttc` 或 `SimSun.ttf`：
  - `simsun.ttc`（宋体）
  - `msyh.ttc` 或 `msyh.ttf`（微软雅黑）

例如在 PowerShell 中（在项目根目录执行）：

```powershell
Copy-Item "C:\Windows\Fonts\simsun.ttc" -Destination "apps\api\fonts\simsun.ttc"
```

或复制微软雅黑：

```powershell
Copy-Item "C:\Windows\Fonts\msyh.ttc" -Destination "apps\api\fonts\msyh.ttc"
```

## 方式二：依赖系统字体

若未在本目录放置字体，程序会尝试使用系统字体路径（如 Windows 的 `C:\Windows\Fonts\simsun.ttc`）。若 API 从其他目录启动或路径不一致，可能仍会乱码，此时请用方式一。
