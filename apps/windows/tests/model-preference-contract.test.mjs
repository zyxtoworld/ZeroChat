import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../ZeroChat/AiClientProtocol.cpp', import.meta.url),
  'utf8',
)
const clientSource = await readFile(
  new URL('../ZeroChat/AiClient.cpp', import.meta.url),
  'utf8',
)

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

test('prefers frontier relay variants when numeric GPT revisions tie', () => {
  const variantBody = functionBody(
    'int ModelVariantPreferenceScore(std::wstring const& model)',
    'bool IsLikelyImageModel',
  )
  const chatBody = functionBody(
    'int ChatModelPreferenceScore(std::wstring const& model)',
    'int ImageModelPreferenceScore',
  )

  assert.match(variantBody, /value == L"sol"[\s\S]*score = score > 1200 \? score : 1200/)
  assert.match(variantBody, /value == L"terra"[\s\S]*score = score > 800 \? score : 800/)
  assert.match(variantBody, /value == L"luna"[\s\S]*score = score > 400 \? score : 400/)
  assert.match(variantBody, /std::iswalnum\(character\)/)
  assert.match(chatBody, /ModelVersionScore\(normalized, L"gpt"\)[\s\S]*ModelVariantPreferenceScore\(normalized\)/)
})

test('ignores dated GPT snapshot tokens when scoring revisions', () => {
  assert.match(
    source,
    /std::wstring StripModelDateToken\(std::wstring const& model\)[\s\S]*return model\.substr\(0, index\) \+ model\.substr\(index \+ 11\)/,
  )
  assert.match(
    source,
    /auto versionSource = StripModelDateToken\(model\);[\s\S]*auto index = versionSource\.find\(family\)/,
  )
})

test('keeps DALL-E 3 out of image editing requests', () => {
  const editingBody = functionBody(
    'bool IsLikelyImageEditingModel(std::wstring const& model)',
    'bool IsLikelyChatModel',
  )

  assert.match(
    editingBody,
    /return IsLikelyImageModel\(model\) && !Contains\(Lowercase\(model\), L"dall-e-3"\);/,
  )
  assert.match(
    clientSource,
    /if \(IsLikelyImageModel\(model\) && !IsLikelyImageEditingModel\(model\)\)[\s\S]*This image model does not support editing\./,
  )
})
