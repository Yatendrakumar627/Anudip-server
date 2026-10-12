export function serialize(doc) {
  if (!doc) return null;
  const value = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const id = value._id != null ? String(value._id) : value.id != null ? String(value.id) : undefined;
  const out = { ...value };
  if (id !== undefined) out.id = id;
  delete out._id;
  return out;
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function isHttpUrl(value) {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
}
