const assert = require('node:assert/strict');
module.exports = async ({
  phase,
  evaluate,
  click,
  fill,
  until,
  checks,
  requests,
}) => {
  if (phase === 'scope-start') {
    assert.ok(
      (
        await evaluate(
          "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
        )
      ).ok,
    );
    await evaluate(
      "document.querySelectorAll('[data-queue-scene]').forEach(c=>c.click())",
    );
    await fill('#live-interval', '0');
    await fill('#live-repeats', '2');
    await click('[data-testid=prepare-live-queue]');
    await until(() =>
      evaluate("!!document.querySelector('[data-testid=send-live-queue]')"),
    );
    await click('[data-testid=send-live-queue]');
    await until(
      async () =>
        requests() === 6 &&
        !(await evaluate('window.electron.generation.status()')).value.active,
    );
    const picks = await evaluate(`(async()=>{
      const api=window.electron.projects, id=(await api.list()).value[0].id;
      const {project,revision}=(await api.open(id)).value;
      const ids=project.scenes.slice(0,2).map(s=>project.images.find(i=>i.sceneId===s.id).id);
      return api.setResultPicks(id,revision,ids,true);
    })()`);
    assert.ok(picks.ok);
    checks.push('completed three scenes twice and kept picks for two scenes');
  } else {
    await click('[data-testid=project-list]');
    await until(() =>
      evaluate("!!document.querySelector('[data-project-open]')"),
    );
    await click('[data-project-open]');
    await until(() =>
      evaluate(
        "document.querySelectorAll('[data-queue-scene]:checked').length===3",
      ),
    );
    await until(() =>
      evaluate(
        "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='선별 (2)');if(b)b.click();return !!b})()",
      ),
    );
    await until(() =>
      evaluate(
        "document.querySelector('[data-testid=prepare-unpicked]')?.textContent.includes('1개')",
      ),
    );
    assert.equal(requests(), 0);
    checks.push(
      'new process offers only the one missing scene without reselecting or sending',
    );
  }
};
