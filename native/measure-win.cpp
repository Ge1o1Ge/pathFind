// Одинаковые границы замера для двух дочерних процессов: полное время и время CPU по данным Windows.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <chrono>
#include <iostream>
#include <string>

static double ms(FILETIME time) {
    ULARGE_INTEGER value;
    value.LowPart = time.dwLowDateTime;
    value.HighPart = time.dwHighDateTime;
    return static_cast<double>(value.QuadPart) / 10000.0;
}
int wmain(int argc, wchar_t** argv) {
    if (argc < 2) return 1;
    std::wstring command;
    for (int i = 1; i < argc; ++i) {
        // Аргументы стенда — имя программы, простые имена файлов и ключи.
        std::wstring part(argv[i]);
        if (part.find(L'"') != std::wstring::npos || (!part.empty() && part.back() == L'\\')) return 1;
        if (!command.empty()) command += L' ';
        command += L'"' + part + L'"';
    }
    STARTUPINFOW info{};
    info.cb = sizeof(info);
    info.dwFlags = STARTF_USESTDHANDLES;
    info.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    info.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    info.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    for (auto handle : {info.hStdInput, info.hStdOutput, info.hStdError})
        if (handle && handle != INVALID_HANDLE_VALUE) SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    PROCESS_INFORMATION process{};
    const auto start = std::chrono::steady_clock::now();
    if (!CreateProcessW(argv[1], command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                        nullptr, nullptr, &info, &process)) {
        std::cerr << "CreateProcessW: " << GetLastError() << '\n';
        return 1;
    }
    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    const double wall = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    FILETIME created{}, finished{}, kernel{}, user{};
    DWORD status = 1;
    const BOOL measured = GetProcessTimes(process.hProcess, &created, &finished, &kernel, &user);
    GetExitCodeProcess(process.hProcess, &status);
    CloseHandle(process.hProcess);
    if (!measured) return 1;
    std::cout << "\nOS_TIME " << wall << ' ' << ms(kernel) + ms(user) << '\n';
    return static_cast<int>(status);
}
