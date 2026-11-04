@echo off
setlocal
set "vcvars="
set "vswhere=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%vswhere%" for /f "usebackq delims=" %%i in (`"%vswhere%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "vcvars=%%i\VC\Auxiliary\Build\vcvars32.bat"
if not defined vcvars set "vcvars=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars32.bat"
if not exist "%vcvars%" (
  echo MSVC x86 build tools not found.
  exit /b 1
)
call "%vcvars%" || exit /b 1
pushd "%~dp0.." || exit /b 1
if not exist build mkdir build
set "opts=/nologo /std:c++17 /O2 /DNDEBUG /EHsc /utf-8 /W4"
cl %opts% native\khvastuns.cpp /Fobuild\khvastuns.obj /Febuild\khvastuns.exe || exit /b 1
cl %opts% native\measure-win.cpp /Fobuild\measure-win.obj /Febuild\measure-win.exe || exit /b 1
popd
