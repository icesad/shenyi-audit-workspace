using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace WorkbenchAcceptance {
    // Read the Unicode COM interface directly. No shell execution or shortcut writes.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW {
        [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr findData, uint flags);
        [PreserveSig] int GetIDList(out IntPtr pidl);
        [PreserveSig] int SetIDList(IntPtr pidl);
        [PreserveSig] int GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count);
        [PreserveSig] int SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        [PreserveSig] int GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count);
        [PreserveSig] int SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        [PreserveSig] int GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count);
    }

    [ComImport, Guid("0000010B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPersistFile {
        [PreserveSig] int GetClassID(out Guid id);
        [PreserveSig] int IsDirty();
        [PreserveSig] int Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    }

    public class ShellLinkInfo {
        public string TargetPath, Arguments, Details;
        public int LoadResult, PathResult, RawResult, ArgumentsResult;

        public static ShellLinkInfo Read(string file) {
            var instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
            try {
                var result = new ShellLinkInfo();
                result.LoadResult = ((IPersistFile)instance).Load(file, 0); // STGM_READ
                if (result.LoadResult != 0) throw new IOException(String.Format("IPersistFile.Load({0}): 0x{1:X8}", file, result.LoadResult));
                var link = (IShellLinkW)instance;
                var target = new StringBuilder(32768);
                var raw = new StringBuilder(32768);
                var arguments = new StringBuilder(32768);
                var working = new StringBuilder(32768);
                result.PathResult = link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
                result.RawResult = link.GetPath(raw, raw.Capacity, IntPtr.Zero, 4); // SLGP_RAWPATH
                result.ArgumentsResult = link.GetArguments(arguments, arguments.Capacity);
                int workingResult = link.GetWorkingDirectory(working, working.Capacity);
                result.TargetPath = result.PathResult == 0 && target.Length > 0 ? target.ToString() :
                    (result.RawResult == 0 ? raw.ToString() : "");
                result.Arguments = arguments.ToString();
                result.Details = String.Format("Load=0x{0:X8}, GetPath=0x{1:X8} '{2}', raw=0x{3:X8} '{4}', args=0x{5:X8} '{6}', workdir=0x{7:X8} '{8}'",
                    result.LoadResult, result.PathResult, target, result.RawResult, raw, result.ArgumentsResult, arguments, workingResult, working);
                return result;
            } finally { Marshal.FinalReleaseComObject(instance); }
        }
    }

    public static class LinkFile {
        // MS-SHLLINK header, LinkInfo and StringData. These fields are failure evidence,
        // never a substitute for the OS's interpretation of the launch target.
        public static string Describe(string path) {
            var length = new FileInfo(path).Length;
            if (length < 76 || length > 4 * 1024 * 1024) return "Unexpected shortcut size: " + length;
            byte[] data = File.ReadAllBytes(path);
            uint flags = BitConverter.ToUInt32(data, 20);
            string prefix = String.Format("bytes={0}, header=0x{1:X8}, flags=0x{2:X8}", length, BitConverter.ToUInt32(data, 0), flags);
            try {
                using (var r = new BinaryReader(new MemoryStream(data))) {
                    var stream = r.BaseStream;
                    stream.Position = 76;
                    if ((flags & 1) != 0) { int idBytes = r.ReadUInt16(); stream.Seek(idBytes, SeekOrigin.Current); }
                    string local = "";
                    if ((flags & 2) != 0) {
                        int start = checked((int)stream.Position);
                        int size = r.ReadInt32(), header = r.ReadInt32();
                        if (size < 28 || header < 28 || header > size || size > data.Length - start) throw new InvalidDataException("Invalid LinkInfo");
                        bool localVolume = (r.ReadUInt32() & 1) != 0;
                        int offset = BitConverter.ToInt32(data, start + 16);
                        int unicode = header >= 36 ? BitConverter.ToInt32(data, start + 28) : 0;
                        bool wide = unicode > 0;
                        if (wide) offset = unicode;
                        if (localVolume && offset >= header && offset < size) {
                            int cursor = offset, width = wide ? 2 : 1;
                            while (cursor <= size - width && (data[start+cursor] != 0 || (wide && data[start+cursor+1] != 0))) cursor += width;
                            local = (wide ? Encoding.Unicode : Encoding.Default).GetString(data, start+offset, cursor-offset);
                        }
                        stream.Position = start + size;
                    }
                    bool textIsWide = (flags & 128) != 0;
                    string relative = "", working = "";
                    foreach (uint bit in new uint[] { 4, 8, 16 }) {
                        if ((flags & bit) == 0) continue;
                        int size = r.ReadUInt16() * (textIsWide ? 2 : 1);
                        if (size > stream.Length - stream.Position) throw new EndOfStreamException();
                        string value = (textIsWide ? Encoding.Unicode : Encoding.Default).GetString(r.ReadBytes(size));
                        if (bit == 8) relative = value;
                        if (bit == 16) working = value;
                    }
                    string fromLink = "";
                    if (relative.Length > 0) fromLink = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(path), relative));
                    return String.Format("{0}, local='{1}' exists={2}, relative='{3}' existsFromLink={4}, working='{5}' exists={6}",
                        prefix, local, File.Exists(local), relative, File.Exists(fromLink), working, Directory.Exists(working));
                }
            } catch (Exception e) { return prefix + ", incomplete link metadata: " + e.Message; }
        }
    }
}
