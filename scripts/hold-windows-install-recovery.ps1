param([string]$LockPath)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    # The caller validates the installation root. This helper only opens its lock.
    if ([string]::IsNullOrEmpty($LockPath) -or
        $LockPath -cnotmatch '^[A-Za-z]:[\\/]' -or
        [IO.Path]::GetFileName($LockPath) -cne '.install.lock' -or
        -not [string]::Equals([IO.Path]::GetFullPath($LockPath), $LockPath.Replace('/', '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Invalid lock path.'
    }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Shenyi.InstallRecovery {
    public static class LockHandle {
        private const uint GenericRead = 0x80000000;
        private const uint DeleteAccess = 0x00010000;
        private const uint OpenExisting = 3;
        private const uint OpenReparsePoint = 0x00200000;
        private const uint DirectoryAttribute = 0x00000010;
        private const uint ReparsePointAttribute = 0x00000400;
        private const uint DiskFile = 1;
        private const int FileDispositionInfo = 4;
        private static readonly IntPtr InvalidHandle = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime {
            public uint Low;
            public uint High;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FileInformation {
            public uint Attributes;
            public FileTime CreationTime;
            public FileTime LastAccessTime;
            public FileTime LastWriteTime;
            public uint VolumeSerialNumber;
            public uint SizeHigh;
            public uint SizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DispositionInformation {
            public byte DeleteFile;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFileW(string name, uint access, uint sharing,
            IntPtr security, uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(IntPtr handle, out FileInformation information);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint GetFileType(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetFileInformationByHandle(IntPtr handle, int informationClass,
            ref DispositionInformation information, uint bufferSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        private static void Report(string status) {
            Console.Out.WriteLine("{\"status\":\"" + status + "\"}");
            Console.Out.Flush();
        }

        private static bool IsEmptyRegularFile(IntPtr handle) {
            FileInformation information;
            return GetFileType(handle) == DiskFile &&
                GetFileInformationByHandle(handle, out information) &&
                (information.Attributes & (DirectoryAttribute | ReparsePointAttribute)) == 0 &&
                information.NumberOfLinks == 1 && information.SizeHigh == 0 && information.SizeLow == 0;
        }

        public static void Run(string path) {
            IntPtr handle = CreateFileW(path, GenericRead | DeleteAccess, 0,
                IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero);
            if (handle == InvalidHandle) {
                int error = Marshal.GetLastWin32Error();
                Report(error == 2 || error == 3 ? "missing" :
                    error == 32 || error == 33 ? "busy" : "invalid");
                return;
            }

            string finalStatus = "invalid";
            try {
                if (!IsEmptyRegularFile(handle)) return;
                Report("held");
                string command = Console.In.ReadLine();
                if (command == null || String.Equals(command, "abort", StringComparison.Ordinal)) {
                    finalStatus = "aborted";
                    return;
                }
                if (!String.Equals(command, "commit", StringComparison.Ordinal) || !IsEmptyRegularFile(handle)) return;

                DispositionInformation disposition = new DispositionInformation { DeleteFile = 1 };
                if (SetFileInformationByHandle(handle, FileDispositionInfo, ref disposition,
                    (uint)Marshal.SizeOf(typeof(DispositionInformation)))) finalStatus = "cleared";
            }
            catch {
                finalStatus = "invalid";
            }
            finally {
                if (!CloseHandle(handle)) finalStatus = "invalid";
                Report(finalStatus);
            }
        }
    }
}
'@ | Out-Null

    [Shenyi.InstallRecovery.LockHandle]::Run($LockPath)
}
catch {
    [Console]::Out.WriteLine('{"status":"invalid"}')
    [Console]::Out.Flush()
}
