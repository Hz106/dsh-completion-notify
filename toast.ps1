param(
  [string]$MetaB64 = '',
  [string]$TitleB64 = '',
  [string]$BodyB64 = '',
  [string]$SessionId = '',
  [string]$BaseUrl = '',
  [int]$Dark = 0
)

$ErrorActionPreference = 'Stop'

function Decode([string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return '' }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
}

$meta = Decode $MetaB64
$title = Decode $TitleB64
$detail = Decode $BodyB64

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Net;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class DshAlertWin32
{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr window, int command);
}

public class DshAlertCard : Form
{
    private const string IconGlyph = "\uE7ED";
    private const string AppProcessName = "DeepSeek Harness";

    private readonly string meta;
    private readonly string heading;
    private readonly string detail;
    private readonly string sessionId;
    private readonly string baseUrl;
    private readonly bool dark;
    private readonly float scale;
    private readonly Timer life;
    private readonly Timer fade;
    private bool hover;
    private bool handled;

    public DshAlertCard(string meta, string heading, string detail, string sessionId, string baseUrl, bool dark)
    {
        this.meta = meta;
        this.heading = heading;
        this.detail = detail;
        this.sessionId = sessionId;
        this.baseUrl = baseUrl;
        this.dark = dark;

        using (Graphics probe = Graphics.FromHwnd(IntPtr.Zero))
        {
            this.scale = probe.DpiX / 96f;
        }

        int width = (int)Math.Round(376 * scale);
        int height = (int)Math.Round(118 * scale);
        int radius = (int)Math.Round(12 * scale);

        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        Cursor = Cursors.Hand;
        BackColor = Background();
        ClientSize = new Size(width, height);
        Region = new Region(Rounded(new Rectangle(0, 0, width, height), radius));

        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        int margin = (int)Math.Round(24 * scale);
        Location = new Point(area.Right - width - margin, area.Bottom - height - margin);
        Opacity = 0;

        fade = new Timer();
        fade.Interval = 16;
        fade.Tick += delegate
        {
            Opacity = Math.Min(1, Opacity + 0.14);
            if (Opacity >= 1)
            {
                fade.Stop();
            }
        };

        life = new Timer();
        life.Interval = 10000;
        life.Tick += delegate
        {
            life.Stop();
            Close();
        };
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= 0x00000080;
            parameters.ClassStyle |= 0x00020000;
            return parameters;
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        fade.Start();
        life.Start();
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        hover = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        hover = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnClick(EventArgs e)
    {
        base.OnClick(e);
        if (handled)
        {
            return;
        }
        handled = true;
        BringAppForward();
        NotifyHost();
        Close();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        int width = Width;
        int height = Height;
        int radius = (int)Math.Round(12 * scale);
        Rectangle bounds = new Rectangle(0, 0, width - 1, height - 1);

        using (GraphicsPath path = Rounded(bounds, radius))
        {
            using (SolidBrush brush = new SolidBrush(hover ? HoverBackground() : Background()))
            {
                graphics.FillPath(brush, path);
            }
            using (Pen pen = new Pen(Border(), Math.Max(1f, scale)))
            {
                graphics.DrawPath(pen, path);
            }
        }

        int pad = (int)Math.Round(16 * scale);
        int iconSize = (int)Math.Round(18 * scale);
        int textWidth = width - pad * 2;

        using (Font iconFont = IconFont(), metaFont = MetaFont(), titleFont = TitleFont(), bodyFont = BodyFont())
        {
            TextRenderer.DrawText(
                graphics,
                IconGlyph,
                iconFont,
                new Rectangle(pad, pad, iconSize, iconSize),
                Muted(),
                TextFormatFlags.NoPadding | TextFormatFlags.Left);

            TextRenderer.DrawText(
                graphics,
                meta,
                metaFont,
                new Rectangle(pad + iconSize + (int)Math.Round(8 * scale), pad, textWidth - iconSize, (int)Math.Round(16 * scale)),
                Muted(),
                TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);

            TextRenderer.DrawText(
                graphics,
                heading,
                titleFont,
                new Rectangle(pad, pad + (int)Math.Round(20 * scale), textWidth, (int)Math.Round(24 * scale)),
                Strong(),
                TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);

            TextRenderer.DrawText(
                graphics,
                detail,
                bodyFont,
                new Rectangle(pad, pad + (int)Math.Round(48 * scale), textWidth, (int)Math.Round(44 * scale)),
                Muted(),
                TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.WordBreak);
        }
    }

    private void BringAppForward()
    {
        try
        {
            foreach (Process process in Process.GetProcessesByName(AppProcessName))
            {
                IntPtr handle = process.MainWindowHandle;
                if (handle == IntPtr.Zero)
                {
                    continue;
                }
                DshAlertWin32.ShowWindow(handle, 9);
                DshAlertWin32.SetForegroundWindow(handle);
                return;
            }
        }
        catch (Exception)
        {
        }
    }

    private void NotifyHost()
    {
        if (sessionId.Length == 0 || baseUrl.Length == 0)
        {
            return;
        }
        try
        {
            using (WebClient client = new WebClient())
            {
                client.Headers[HttpRequestHeader.ContentType] = "application/json";
                client.Headers["x-completion-notify"] = "1";
                client.UploadString(
                    baseUrl.TrimEnd('/') + "/completion-notify/click",
                    "POST",
                    "{\"sessionId\":\"" + sessionId + "\"}");
            }
        }
        catch (Exception)
        {
        }
    }

    private Color Background()
    {
        return dark ? Color.FromArgb(30, 31, 35) : Color.FromArgb(255, 255, 255);
    }

    private Color HoverBackground()
    {
        return dark ? Color.FromArgb(37, 38, 43) : Color.FromArgb(247, 248, 249);
    }

    private Color Border()
    {
        return dark ? Color.FromArgb(46, 255, 255, 255) : Color.FromArgb(24, 17, 20, 26);
    }

    private Color Strong()
    {
        return dark ? Color.FromArgb(247, 248, 250) : Color.FromArgb(15, 17, 21);
    }

    private Color Muted()
    {
        return dark ? Color.FromArgb(170, 176, 184) : Color.FromArgb(110, 116, 122);
    }

    private static FontFamily Family(string name)
    {
        try
        {
            return new FontFamily(name);
        }
        catch (ArgumentException)
        {
            return new FontFamily("Segoe UI");
        }
    }

    private Font TitleFont()
    {
        return new Font(Family("Segoe UI Variable Text"), 10.5f, FontStyle.Bold, GraphicsUnit.Point);
    }

    private Font MetaFont()
    {
        return new Font(Family("Segoe UI Variable Text"), 8.5f, FontStyle.Regular, GraphicsUnit.Point);
    }

    private Font BodyFont()
    {
        return new Font(Family("Segoe UI Variable Text"), 9f, FontStyle.Regular, GraphicsUnit.Point);
    }

    private Font IconFont()
    {
        return new Font(Family("Segoe MDL2 Assets"), 10f, FontStyle.Regular, GraphicsUnit.Point);
    }

    private static GraphicsPath Rounded(Rectangle bounds, int radius)
    {
        int diameter = Math.Max(2, radius * 2);
        GraphicsPath path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
'@

[DshAlertWin32]::SetProcessDPIAware() | Out-Null
$card = New-Object -TypeName DshAlertCard -ArgumentList @($meta, $title, $detail, $SessionId, $BaseUrl, ($Dark -ne 0))
[System.Windows.Forms.Application]::Run($card)

