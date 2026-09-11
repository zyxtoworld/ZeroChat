import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [header, source] = await Promise.all([
  readFile(new URL('../ZeroChat/MainWindow.xaml.h', import.meta.url), 'utf8'),
  readFile(new URL('../ZeroChat/MainWindowTray.cpp', import.meta.url), 'utf8'),
])

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

test('installs the tray window subclass transactionally', () => {
  const body = functionBody(
    'void MainWindow::InitializeTrayIcon()',
    'bool MainWindow::AddTrayIcon()',
  )

  const readOriginal = body.indexOf('GetWindowLongPtrW(')
  const installProperty = body.indexOf('SetPropW(')
  const installSubclass = body.indexOf('SetWindowLongPtrW(')

  assert.ok(readOriginal >= 0)
  assert.ok(readOriginal < installProperty)
  assert.ok(installProperty < installSubclass)
  assert.match(body, /if \(!SetPropW\(/)
  assert.match(
    body,
    /if \(!previousWindowProc && GetLastError\(\) != ERROR_SUCCESS\)[\s\S]*RemovePropW\(/,
  )
  assert.match(body, /m_windowHandle = nullptr;/)
})

test('never lets C++ exceptions escape the Win32 window procedure', () => {
  assert.match(
    header,
    /static LRESULT CALLBACK TrayWindowProc\(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam\) noexcept;/,
  )

  const body = source.slice(source.indexOf('LRESULT CALLBACK MainWindow::TrayWindowProc('))
  assert.match(body, /auto originalWindowProc = window->m_originalWindowProc;/)
  assert.match(body, /try\s*\{/)
  assert.match(
    body,
    /catch \(\.\.\.\)[\s\S]*CallWindowProcW\(originalWindowProc, hwnd, message, wparam, lparam\)/,
  )
})
