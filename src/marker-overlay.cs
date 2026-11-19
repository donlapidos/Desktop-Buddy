// Live marking (marker-live.js): a see-through window over one display that the user draws on while their apps keep
// running underneath. It's a layered window drawn with GDI+ into memory, and each change is handed to Windows as only
// the small rectangle that changed (UpdateLayeredWindowIndirect with a dirty rectangle), so Windows recomposes a few
// hundred pixels per pen move instead of the whole screen. That full-screen repaint is what made drawing on Buddy's own
// see-through Electron window lag (marker.js).
//
// Built on the user's PC by the C# compiler that comes with Windows (.NET Framework 4), so it's C# 5. It talks to Buddy
// in JSON lines: commands on stdin, events on stdout. Coordinates are physical pixels; points it reports are on the
// screen (the window's origin added).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class Win
{
    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEX
    {
        public uint cbSize, style;
        public WndProc lpfnWndProc;
        public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground;
        public string lpszMenuName, lpszClassName;
        public IntPtr hIconSm;
    }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] public struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [StructLayout(LayoutKind.Sequential)]
    public struct UPDATELAYEREDWINDOWINFO
    {
        public uint cbSize;
        public IntPtr hdcDst, pptDst, psize, hdcSrc, pptSrc;
        public uint crKey;
        public IntPtr pblend;
        public uint dwFlags;
        public IntPtr prcDirty;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAPINFOHEADER
    {
        public uint biSize; public int biWidth, biHeight; public ushort biPlanes, biBitCount;
        public uint biCompression, biSizeImage; public int biXPelsPerMeter, biYPelsPerMeter; public uint biClrUsed, biClrImportant;
    }
    [StructLayout(LayoutKind.Sequential)] public struct ICONINFO { public bool fIcon; public int xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowEx(uint exStyle, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool UpdateLayeredWindowIndirect(IntPtr hwnd, ref UPDATELAYEREDWINDOWINFO info);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr SetCapture(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr inst, IntPtr name);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] public static extern short GetKeyState(int key);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr CreateIconIndirect(ref ICONINFO info);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateBitmap(int w, int h, uint planes, uint bits, IntPtr data);
}

class Stroke
{
    public int N;
    public List<PointF> Points = new List<PointF>();
    public RectangleF Box;
}

class Overlay
{
    const uint WM_DESTROY = 0x0002, WM_SETCURSOR = 0x0020, WM_KEYDOWN = 0x0100, WM_MOUSEMOVE = 0x0200, WM_LBUTTONDOWN = 0x0201,
        WM_LBUTTONUP = 0x0202, WM_RBUTTONUP = 0x0205, WM_CAPTURECHANGED = 0x0215, WM_MOUSEACTIVATE = 0x0021, WM_APP = 0x8000;
    const int GWL_EXSTYLE = -20;
    const uint WS_POPUP = 0x80000000, WS_EX_LAYERED = 0x80000, WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000;
    const int MAX_POINTS = 4000, MAX_STROKES = 50;

    static readonly object Out = new object();
    // A window program has no console: the pipes Buddy gave it are used directly, in UTF-8.
    static readonly StreamWriter stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    static readonly ConcurrentQueue<Dictionary<string, object>> Inbox = new ConcurrentQueue<Dictionary<string, object>>();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
    static Win.WndProc proc;
    static IntPtr hwnd, memDC, dib, oldBitmap, bits, penCursor;
    static Bitmap canvas;
    static Graphics g;
    static int X, Y, W, H;
    static float scale = 1, pen = 18;
    static Color accent = Color.FromArgb(0x2f, 0x7a, 0xff);
    static bool drawing = true, framed = true;
    static readonly List<Stroke> strokes = new List<Stroke>();
    static Stroke live;
    static long liveStarted;
    static readonly Stopwatch clock = Stopwatch.StartNew();
    static int updates;
    static double totalMs, maxMs;

    static void Say(Dictionary<string, object> ev)
    {
        string line = Json.Serialize(ev);
        lock (Out) { stdout.Write(line + "\n"); stdout.Flush(); }
    }
    static Dictionary<string, object> Ev(string name) { var d = new Dictionary<string, object>(); d["ev"] = name; return d; }
    static double Num(Dictionary<string, object> m, string key, double fallback)
    {
        object v;
        return m.TryGetValue(key, out v) && v != null ? Convert.ToDouble(v, CultureInfo.InvariantCulture) : fallback;
    }

    [STAThread]
    static int Main()
    {
        try { Win.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } // per-monitor v2: physical pixels throughout
        var reader = new Thread(ReadCommands) { IsBackground = true };
        reader.Start();
        // Nothing to draw on until Buddy says where.
        Dictionary<string, object> first;
        while (!Inbox.TryDequeue(out first)) Thread.Sleep(5);
        if ((first["cmd"] as string) != "start") { var e = Ev("error"); e["message"] = "the first command must be start"; Say(e); return 2; }
        Start(first);
        Win.MSG msg;
        while (Win.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { Win.TranslateMessage(ref msg); Win.DispatchMessage(ref msg); }
        return 0;
    }

    static void ReadCommands()
    {
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            try { Inbox.Enqueue(Json.Deserialize<Dictionary<string, object>>(line)); }
            catch (Exception ex) { var e = Ev("error"); e["message"] = "unreadable command: " + ex.Message; Say(e); continue; }
            if (hwnd != IntPtr.Zero) Win.PostMessage(hwnd, WM_APP, IntPtr.Zero, IntPtr.Zero);
        }
        // Buddy went away: so does the overlay.
        var quit = new Dictionary<string, object>(); quit["cmd"] = "quit"; Inbox.Enqueue(quit);
        if (hwnd != IntPtr.Zero) Win.PostMessage(hwnd, WM_APP, IntPtr.Zero, IntPtr.Zero);
    }

    static void Start(Dictionary<string, object> m)
    {
        X = (int)Num(m, "x", 0); Y = (int)Num(m, "y", 0); W = Math.Max(1, (int)Num(m, "w", 800)); H = Math.Max(1, (int)Num(m, "h", 600));
        scale = (float)Num(m, "scale", 1);
        pen = (float)Num(m, "pen", 18) * scale;
        object c;
        if (m.TryGetValue("color", out c) && c is string && ((string)c).Length == 7) accent = ColorTranslator.FromHtml((string)c);

        var screen = Win.GetDC(IntPtr.Zero);
        memDC = Win.CreateCompatibleDC(screen);
        Win.ReleaseDC(IntPtr.Zero, screen);
        var bmi = new Win.BITMAPINFOHEADER { biSize = (uint)Marshal.SizeOf(typeof(Win.BITMAPINFOHEADER)), biWidth = W, biHeight = -H, biPlanes = 1, biBitCount = 32 };
        dib = Win.CreateDIBSection(memDC, ref bmi, 0, out bits, IntPtr.Zero, 0);
        oldBitmap = Win.SelectObject(memDC, dib);
        // GDI+ draws straight into the window's pixels: premultiplied, as a layered window wants them.
        canvas = new Bitmap(W, H, W * 4, PixelFormat.Format32bppPArgb, bits);
        g = Graphics.FromImage(canvas);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        penCursor = MakeCursor();

        proc = WindowProc;
        var wc = new Win.WNDCLASSEX { cbSize = (uint)Marshal.SizeOf(typeof(Win.WNDCLASSEX)), lpfnWndProc = proc, hInstance = Marshal.GetHINSTANCE(typeof(Overlay).Module), lpszClassName = "BuddyLiveMarker" };
        Win.RegisterClassEx(ref wc);
        // Never takes the keyboard or comes to the front when clicked: Buddy's toolbar stays above it, and Enter, Esc and
        // Ctrl+Z reach Buddy as shortcuts while marking.
        hwnd = Win.CreateWindowEx(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, "BuddyLiveMarker", "Buddy marker", WS_POPUP, X, Y, W, H, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
        Redraw(new Rectangle(0, 0, W, H), true);
        Win.ShowWindow(hwnd, 4); // SW_SHOWNOACTIVATE
        var ready = Ev("ready"); ready["hwnd"] = hwnd.ToInt64(); Say(ready);
        Win.PostMessage(hwnd, WM_APP, IntPtr.Zero, IntPtr.Zero);
    }

    // The pen as the cursor: a translucent disc the size of the stroke, ringed in the accent.
    static IntPtr MakeCursor()
    {
        int size = Math.Max(16, (int)Math.Ceiling(pen + 6));
        using (var b = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var cg = Graphics.FromImage(b))
        {
            cg.SmoothingMode = SmoothingMode.AntiAlias;
            float r = pen / 2;
            float c = size / 2f;
            using (var fill = new SolidBrush(Color.FromArgb(90, accent))) cg.FillEllipse(fill, c - r, c - r, 2 * r, 2 * r);
            using (var ring = new Pen(Deep(), 1.5f * scale)) cg.DrawEllipse(ring, c - r, c - r, 2 * r, 2 * r);
            using (var dot = new SolidBrush(Deep())) cg.FillEllipse(dot, c - 1.5f, c - 1.5f, 3, 3);
            var color = b.GetHbitmap(Color.FromArgb(0, 0, 0, 0));
            var mask = Win.CreateBitmap(size, size, 1, 1, IntPtr.Zero);
            var info = new Win.ICONINFO { fIcon = false, xHotspot = size / 2, yHotspot = size / 2, hbmMask = mask, hbmColor = color };
            var cursor = Win.CreateIconIndirect(ref info);
            Win.DeleteObject(color); Win.DeleteObject(mask);
            return cursor != IntPtr.Zero ? cursor : Win.LoadCursor(IntPtr.Zero, new IntPtr(32515));
        }
    }

    static Color Deep() { return Color.FromArgb((int)(accent.R * 0.78), (int)(accent.G * 0.78), (int)(accent.B * 0.78)); }

    // Through the midpoints, as quadratic curves (cubics here): strokes read as pen, not polyline. Same as marker.js.
    static GraphicsPath PathOf(List<PointF> pts)
    {
        var path = new GraphicsPath();
        if (pts.Count == 1) { path.AddLine(pts[0], new PointF(pts[0].X + 0.01f, pts[0].Y)); return path; }
        PointF from = pts[0];
        for (int i = 1; i < pts.Count - 1; i++)
        {
            var c = pts[i];
            var to = new PointF((pts[i].X + pts[i + 1].X) / 2, (pts[i].Y + pts[i + 1].Y) / 2);
            path.AddBezier(from, new PointF(from.X + 2f / 3 * (c.X - from.X), from.Y + 2f / 3 * (c.Y - from.Y)),
                new PointF(to.X + 2f / 3 * (c.X - to.X), to.Y + 2f / 3 * (c.Y - to.Y)), to);
            from = to;
        }
        path.AddLine(from, pts[pts.Count - 1]);
        return path;
    }

    static Pen Ink(int alpha)
    {
        var p = new Pen(Color.FromArgb(alpha, accent), pen);
        p.StartCap = p.EndCap = LineCap.Round;
        p.LineJoin = LineJoin.Round;
        return p;
    }

    static RectangleF BoxOf(List<PointF> pts, int from)
    {
        float l = float.MaxValue, t = float.MaxValue, r = float.MinValue, b = float.MinValue;
        for (int i = Math.Max(0, from); i < pts.Count; i++) { l = Math.Min(l, pts[i].X); t = Math.Min(t, pts[i].Y); r = Math.Max(r, pts[i].X); b = Math.Max(b, pts[i].Y); }
        return RectangleF.FromLTRB(l, t, r, b);
    }

    static Rectangle Grow(RectangleF r, float by)
    {
        var g2 = Rectangle.FromLTRB((int)Math.Floor(r.Left - by), (int)Math.Floor(r.Top - by), (int)Math.Ceiling(r.Right + by), (int)Math.Ceiling(r.Bottom + by));
        g2.Intersect(new Rectangle(0, 0, W, H));
        return g2;
    }

    // Repaints one rectangle of the window from scratch: the barely-there backdrop that keeps the mouse ours, the frame,
    // the finished strokes and their numbers, the stroke being drawn. Then only that rectangle goes to Windows.
    static void Redraw(Rectangle dirty, bool whole)
    {
        if (dirty.Width <= 0 || dirty.Height <= 0) return;
        long started = clock.ElapsedTicks;
        g.SetClip(dirty);
        g.CompositingMode = CompositingMode.SourceCopy;
        // Alpha 1 is invisible, but a fully clear pixel lets clicks through: while drawing, every pixel is ours.
        using (var back = new SolidBrush(Color.FromArgb(drawing ? 1 : 0, 0, 0, 0))) g.FillRectangle(back, dirty);
        g.CompositingMode = CompositingMode.SourceOver;
        if (framed)
        {
            float f = 3 * scale;
            using (var frame = new Pen(Color.FromArgb(217, accent), f)) g.DrawRectangle(frame, f / 2, f / 2, W - f, H - f);
        }
        using (var ink = Ink(92))
            foreach (var s in strokes) if (Grow(s.Box, pen).IntersectsWith(dirty)) using (var path = PathOf(s.Points)) g.DrawPath(ink, path);
        if (live != null) using (var ink = Ink(128)) using (var path = PathOf(live.Points)) g.DrawPath(ink, path);
        foreach (var s in strokes) Disc(s);
        g.Flush(FlushIntention.Sync);
        g.ResetClip();
        Push(whole ? (Rectangle?)null : dirty);
        double ms = (clock.ElapsedTicks - started) * 1000.0 / Stopwatch.Frequency;
        updates++; totalMs += ms; maxMs = Math.Max(maxMs, ms);
    }

    static void Disc(Stroke s)
    {
        float x = s.Points[0].X - 14 * scale, y = s.Points[0].Y - 14 * scale, r = 11 * scale;
        using (var fill = new SolidBrush(Deep())) g.FillEllipse(fill, x - r, y - r, 2 * r, 2 * r);
        using (var ring = new Pen(Color.White, 2 * scale)) g.DrawEllipse(ring, x - r, y - r, 2 * r, 2 * r);
        using (var font = new Font("Segoe UI", 13 * scale, FontStyle.Bold, GraphicsUnit.Pixel))
        using (var white = new SolidBrush(Color.White))
        using (var middle = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            g.DrawString(s.N.ToString(CultureInfo.InvariantCulture), font, white, new RectangleF(x - r, y - r + 0.5f * scale, 2 * r, 2 * r), middle);
    }

    static Rectangle DiscBox(Stroke s) { return Grow(new RectangleF(s.Points[0].X - 26 * scale, s.Points[0].Y - 26 * scale, 24 * scale, 24 * scale), 2); }

    static void Push(Rectangle? dirty)
    {
        var size = new Win.SIZE { cx = W, cy = H };
        var src = new Win.POINT();
        var dst = new Win.POINT { x = X, y = Y };
        var blend = new Win.BLENDFUNCTION { BlendOp = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
        var hSize = GCHandle.Alloc(size, GCHandleType.Pinned);
        var hSrc = GCHandle.Alloc(src, GCHandleType.Pinned);
        var hDst = GCHandle.Alloc(dst, GCHandleType.Pinned);
        var hBlend = GCHandle.Alloc(blend, GCHandleType.Pinned);
        GCHandle hDirty = default(GCHandle);
        try
        {
            var info = new Win.UPDATELAYEREDWINDOWINFO
            {
                cbSize = (uint)Marshal.SizeOf(typeof(Win.UPDATELAYEREDWINDOWINFO)),
                pptDst = hDst.AddrOfPinnedObject(), psize = hSize.AddrOfPinnedObject(), hdcSrc = memDC, pptSrc = hSrc.AddrOfPinnedObject(),
                pblend = hBlend.AddrOfPinnedObject(), dwFlags = 2, // ULW_ALPHA
            };
            if (dirty.HasValue)
            {
                var r = new Win.RECT { left = dirty.Value.Left, top = dirty.Value.Top, right = dirty.Value.Right, bottom = dirty.Value.Bottom };
                hDirty = GCHandle.Alloc(r, GCHandleType.Pinned);
                info.prcDirty = hDirty.AddrOfPinnedObject();
            }
            Win.UpdateLayeredWindowIndirect(hwnd, ref info);
        }
        finally
        {
            hSize.Free(); hSrc.Free(); hDst.Free(); hBlend.Free();
            if (hDirty.IsAllocated) hDirty.Free();
        }
    }

    static void Count()
    {
        var e = Ev("count"); e["n"] = strokes.Count; Say(e);
    }

    static object PointsOut(List<PointF> pts)
    {
        var list = new List<object>(pts.Count);
        foreach (var p in pts) list.Add(new[] { Math.Round(p.X + X, 1), Math.Round(p.Y + Y, 1) });
        return list;
    }

    static void Down(float x, float y)
    {
        if (!drawing || live != null) return;
        Win.SetCapture(hwnd);
        live = new Stroke { N = strokes.Count + 1 };
        live.Points.Add(new PointF(x, y));
        liveStarted = clock.ElapsedMilliseconds;
        Redraw(Grow(new RectangleF(x, y, 0, 0), pen), false);
    }

    static void Move(float x, float y)
    {
        if (live == null) return;
        var last = live.Points[live.Points.Count - 1];
        double d = Math.Sqrt((x - last.X) * (x - last.X) + (y - last.Y) * (y - last.Y));
        if (d < 1.5 * scale) return;
        live.Points.Add(new PointF(x, y));
        if (live.Points.Count > MAX_POINTS)
        {
            // Thin the older samples rather than freeze the pen at the end of its budget (marker-stroke.js).
            var kept = new List<PointF>();
            for (int i = 0; i < live.Points.Count; i++) if (i % 2 == 0 || i == live.Points.Count - 1) kept.Add(live.Points[i]);
            live.Points = kept;
            Redraw(Grow(BoxOf(live.Points, 0), pen), false);
            return;
        }
        // Only the last few points change the smoothed curve.
        Redraw(Grow(BoxOf(live.Points, live.Points.Count - 4), pen), false);
    }

    static void Up(float x, float y)
    {
        if (live == null) return;
        // Taken first: releasing the mouse sends WM_CAPTURECHANGED at once, which drops a stroke still marked live.
        var s = live;
        live = null;
        Win.ReleaseCapture();
        var last = s.Points[s.Points.Count - 1];
        if (last.X != x || last.Y != y) s.Points.Add(new PointF(x, y));
        s.Box = BoxOf(s.Points, 0);
        // A quick click with nothing marked yet means "explain this".
        if (strokes.Count == 0 && Math.Sqrt(s.Box.Width * s.Box.Width + s.Box.Height * s.Box.Height) < 6 * scale && clock.ElapsedMilliseconds - liveStarted < 500)
        {
            Redraw(Grow(s.Box, pen), false);
            var e = Ev("click"); e["x"] = Math.Round(s.Points[0].X + X, 1); e["y"] = Math.Round(s.Points[0].Y + Y, 1); Say(e);
            return;
        }
        if (strokes.Count >= MAX_STROKES) { Redraw(Grow(s.Box, pen), false); return; }
        strokes.Add(s);
        var dirty = Grow(s.Box, pen);
        dirty = Rectangle.Union(dirty, DiscBox(s));
        Redraw(dirty, false);
        Count();
    }

    static void Undo()
    {
        if (live != null || strokes.Count == 0) return;
        var s = strokes[strokes.Count - 1];
        strokes.RemoveAt(strokes.Count - 1);
        Redraw(Rectangle.Union(Grow(s.Box, pen), DiscBox(s)), false);
        Count();
    }

    // Drawing is over: the window lets clicks through, the frame goes, the marks stay until Buddy says quit.
    static void Finish()
    {
        if (live != null) { Win.ReleaseCapture(); live = null; }
        drawing = false;
        framed = false;
        Win.SetWindowLong(hwnd, GWL_EXSTYLE, Win.GetWindowLong(hwnd, GWL_EXSTYLE) | (int)(WS_EX_TRANSPARENT | WS_EX_NOACTIVATE));
        Redraw(new Rectangle(0, 0, W, H), true);
        var e = Ev("finished");
        var list = new List<object>();
        foreach (var s in strokes) { var d = new Dictionary<string, object>(); d["n"] = s.N; d["points"] = PointsOut(s.Points); list.Add(d); }
        e["strokes"] = list;
        Say(e);
    }

    static void Handle(Dictionary<string, object> m)
    {
        string cmd = m.ContainsKey("cmd") ? m["cmd"] as string : null;
        if (cmd == "undo") Undo();
        else if (cmd == "finish") Finish();
        else if (cmd == "quit") Win.DestroyWindow(hwnd);
        else if (cmd == "stats")
        {
            var e = Ev("stats"); e["updates"] = updates; e["avgMs"] = updates > 0 ? Math.Round(totalMs / updates, 3) : 0; e["maxMs"] = Math.Round(maxMs, 3); Say(e);
        }
        else if (cmd == "stroke" || cmd == "click")
        {
            // Test hooks (BUDDY_MARK_LIVE_TEST): a stroke or click as if drawn by hand, through the same path. Points are
            // on the screen, like the ones reported.
            var pts = new List<PointF>();
            if (cmd == "click") pts.Add(new PointF((float)Num(m, "x", 0) - X, (float)Num(m, "y", 0) - Y));
            else foreach (var p in (System.Collections.ArrayList)m["points"]) { var xy = (System.Collections.ArrayList)p; pts.Add(new PointF(Convert.ToSingle(xy[0], CultureInfo.InvariantCulture) - X, Convert.ToSingle(xy[1], CultureInfo.InvariantCulture) - Y)); }
            if (pts.Count == 0) return;
            Down(pts[0].X, pts[0].Y);
            for (int i = 1; i < pts.Count; i++) Move(pts[i].X, pts[i].Y);
            Up(pts[pts.Count - 1].X, pts[pts.Count - 1].Y);
        }
        else if (cmd == "probe")
        {
            // What a pixel holds (premultiplied ARGB), so a check can see a stroke is drawn where it should be.
            int x = (int)Num(m, "x", 0) - X, y = (int)Num(m, "y", 0) - Y;
            var e = Ev("probe");
            e["alpha"] = x >= 0 && y >= 0 && x < W && y < H ? (int)Marshal.ReadByte(bits, (y * W + x) * 4 + 3) : -1;
            Say(e);
        }
    }

    static IntPtr WindowProc(IntPtr h, uint msg, IntPtr w, IntPtr l)
    {
        switch (msg)
        {
            case WM_APP:
                Dictionary<string, object> m;
                while (Inbox.TryDequeue(out m)) Handle(m);
                return IntPtr.Zero;
            case WM_SETCURSOR:
                if (drawing) { Win.SetCursor(penCursor); return new IntPtr(1); }
                break;
            case WM_MOUSEACTIVATE:
                return new IntPtr(3); // MA_NOACTIVATE
            case WM_LBUTTONDOWN: Down(Lo(l), Hi(l)); return IntPtr.Zero;
            case WM_MOUSEMOVE: Move(Lo(l), Hi(l)); return IntPtr.Zero;
            case WM_LBUTTONUP: Up(Lo(l), Hi(l)); return IntPtr.Zero;
            case WM_RBUTTONUP: if (drawing) Undo(); return IntPtr.Zero;
            case WM_CAPTURECHANGED:
                if (live != null && l != h) { var s = live; live = null; Redraw(Grow(BoxOf(s.Points, 0), pen), false); }
                return IntPtr.Zero;
            case WM_KEYDOWN:
                if (!drawing) break;
                int key = w.ToInt32();
                bool ctrl = (Win.GetKeyState(0x11) & 0x8000) != 0;
                if (key == 0x0D) { var e = Ev("key"); e["key"] = "enter"; Say(e); }
                else if (key == 0x1B) { var e = Ev("key"); e["key"] = "escape"; Say(e); }
                else if ((ctrl && key == 0x5A) || key == 0x08) Undo();
                return IntPtr.Zero;
            case WM_DESTROY:
                Win.PostQuitMessage(0);
                return IntPtr.Zero;
        }
        return Win.DefWindowProc(h, msg, w, l);
    }

    static float Lo(IntPtr l) { return (short)(l.ToInt64() & 0xffff); }
    static float Hi(IntPtr l) { return (short)((l.ToInt64() >> 16) & 0xffff); }
}
