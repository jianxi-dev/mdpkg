// 相对引用解析单测（OpenSpec folder-drop-open 组 0，任务 0.1）
// resolveRef 为纯字符串段级压平：不触文件系统、不调 normalizePath（条目路径校验与引用文本解析分离）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRef } from '../src/refpath.ts';

test('resolveRef: 父级 ../ 引用按文档目录解析', () => {
  assert.equal(resolveRef('docs', '../assets/a.png'), 'assets/a.png');
  // a/b/../../x.png 恰好落在包根（非越根），解析为 x.png
  assert.equal(resolveRef('a/b', '../../x.png'), 'x.png');
  assert.equal(resolveRef('a', 'b/../c.png'), 'a/c.png');
});

test('resolveRef: 同级 ./ 与裸引用保留目录', () => {
  assert.equal(resolveRef('docs', './x.png'), 'docs/x.png');
  assert.equal(resolveRef('docs', 'x.png'), 'docs/x.png');
  assert.equal(resolveRef('', 'x.png'), 'x.png');
});

test('resolveRef: 越出包根返回 null', () => {
  assert.equal(resolveRef('', '../x.png'), null);
  assert.equal(resolveRef('a', '../../x.png'), null);
  assert.equal(resolveRef('docs', '../../x.png'), null);
});

test('resolveRef: 空引用返回 null', () => {
  assert.equal(resolveRef('docs', ''), null);
  assert.equal(resolveRef('', ''), null);
});