const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  extraElectronArgs,
} = require('../../.erb/scripts/isolated-profile.cjs');
const linuxOnly = {
  skip:
    process.platform !== 'linux'
      ? 'Uses a synthetic XDG_CONFIG_HOME; real platform coverage is Linux only'
      : false,
};

test(
  'real Electron profile check leaves both original profile spellings unchanged',
  linuxOnly,
  (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sdstudio-electron-profile-'),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const appData = path.join(root, 'app-data');
    const sentinels = [];
    for (const name of ['sdstudio', 'SDStudio']) {
      const original = path.join(appData, name, 'SDStudio');
      if (fs.existsSync(original)) continue;
      fs.mkdirSync(original, { recursive: true });
      for (const file of ['config.json', 'TOKEN.txt', 'session.json']) {
        const target = path.join(original, file);
        fs.writeFileSync(
          target,
          file === 'config.json'
            ? JSON.stringify({ saveLocation: original })
            : 'synthetic fixture',
        );
        sentinels.push({
          target,
          contents: fs.readFileSync(target),
          modified: fs.statSync(target).mtimeMs,
        });
      }
    }
    const selected = path.join(root, 'isolated');
    const result = spawnSync(
      process.execPath,
      [
        '.erb/scripts/isolated-profile.cjs',
        'check',
        selected,
        '--ozone-platform=headless',
        '--disable-gpu',
        ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, XDG_CONFIG_HOME: appData, APPDATA: appData },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"checkOnly":true/);
    const line = result.stdout
      .split('\n')
      .find((value) => value.startsWith('[SDStudio profile] '));
    const report = JSON.parse(line.slice('[SDStudio profile] '.length));
    assert.equal(report.userData, fs.realpathSync(selected));
    assert.equal(fs.existsSync(path.join(selected, 'SDStudio')), false);
    for (const { target, contents, modified } of sentinels) {
      assert.deepEqual(fs.readFileSync(target), contents);
      assert.equal(fs.statSync(target).mtimeMs, modified);
    }
    console.log(
      'Real Electron exited before config/token/session initialization; fixture contents and mtimes unchanged.',
    );
  },
);

test(
  'real Electron does not create an absent original profile',
  linuxOnly,
  (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sdstudio-empty-profile-'),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const appData = path.join(root, 'app-data');
    fs.mkdirSync(appData);
    const selected = path.join(root, 'isolated');
    const result = spawnSync(
      process.execPath,
      [
        '.erb/scripts/isolated-profile.cjs',
        'check',
        selected,
        '--ozone-platform=headless',
        '--disable-gpu',
        ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, XDG_CONFIG_HOME: appData },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(appData), []);
  },
);
