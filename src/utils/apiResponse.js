export function sendSuccess(res, message, data = {}, status = 200) {
  return res.status(status).json({
    success: true,
    message,
    data,
  });
}

export function sendError(res, message, status = 400) {
  return res.status(status).json({
    success: false,
    message,
  });
}
