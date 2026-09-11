$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:ZEROCHAT_JOB_COMMAND_LINE)) {
  [Console]::Error.WriteLine('Windows job launcher command line is missing.')
  exit 125
}

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class ZeroChatWindowsJob {
  private const uint CREATE_SUSPENDED = 0x00000004;
  private const uint STARTF_USESTDHANDLES = 0x00000100;
  private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  private const int JobObjectExtendedLimitInformation = 9;
  private const uint INFINITE = 0xFFFFFFFF;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX;
    public int dwY;
    public int dwXSize;
    public int dwYSize;
    public int dwXCountChars;
    public int dwYCountChars;
    public int dwFillAttribute;
    public uint dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public uint dwProcessId;
    public uint dwThreadId;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetInformationJobObject(
    IntPtr hJob,
    int JobObjectInformationClass,
    ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInformation,
    uint cbJobObjectInformationLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CreateProcess(
    string lpApplicationName,
    StringBuilder lpCommandLine,
    IntPtr lpProcessAttributes,
    IntPtr lpThreadAttributes,
    bool bInheritHandles,
    uint dwCreationFlags,
    IntPtr lpEnvironment,
    string lpCurrentDirectory,
    ref STARTUPINFO lpStartupInfo,
    out PROCESS_INFORMATION lpProcessInformation);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint ResumeThread(IntPtr hThread);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr hObject);

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetStdHandle(int nStdHandle);

  public static int Run(string commandLine, string currentDirectory) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

    try {
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (!SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        ref limits,
        (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      STARTUPINFO startup = new STARTUPINFO();
      startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
      startup.dwFlags = STARTF_USESTDHANDLES;
      startup.hStdInput = GetStdHandle(-10);
      startup.hStdOutput = GetStdHandle(-11);
      startup.hStdError = GetStdHandle(-12);
      PROCESS_INFORMATION process;
      StringBuilder mutableCommandLine = new StringBuilder(commandLine);
      if (!CreateProcess(
        null,
        mutableCommandLine,
        IntPtr.Zero,
        IntPtr.Zero,
        true,
        CREATE_SUSPENDED,
        IntPtr.Zero,
        currentDirectory,
        ref startup,
        out process)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      try {
        if (!AssignProcessToJobObject(job, process.hProcess)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        if (ResumeThread(process.hThread) == 0xFFFFFFFF) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        Console.Out.WriteLine("ZEROCHAT_WINDOWS_JOB_READY");
        Console.Out.Flush();
        WaitForSingleObject(process.hProcess, INFINITE);
        uint exitCode;
        if (!GetExitCodeProcess(process.hProcess, out exitCode)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        return unchecked((int)exitCode);
      } catch {
        TerminateProcess(process.hProcess, 125);
        WaitForSingleObject(process.hProcess, INFINITE);
        throw;
      } finally {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
      }
    } finally {
      CloseHandle(job);
    }
  }
}
'@

try {
  $exitCode = [ZeroChatWindowsJob]::Run(
    $env:ZEROCHAT_JOB_COMMAND_LINE,
    (Get-Location).Path)
  exit $exitCode
} catch {
  [Console]::Error.WriteLine('Windows job launcher failed.')
  exit 125
}
