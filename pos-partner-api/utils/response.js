'use strict';

/**
 * Standard API success response
 */
function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...data,
  });
}

/**
 * Standard API error response
 */
function error(res, statusCode, message, code = 'ERROR', details = null) {
  const body = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (details) {
    body.error.details = details;
  }
  return res.status(statusCode).json(body);
}

/**
 * Paginated response wrapper
 */
function paginated(res, { data, total, page, pageSize, summary = null }) {
  const totalPages = Math.ceil(total / pageSize);
  const response = {
    success: true,
    data,
    pagination: {
      page,
      page_size: pageSize,
      total_records: total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  };
  if (summary) {
    response.summary = summary;
  }
  return res.status(200).json(response);
}

module.exports = {
  success,
  error,
  paginated,
};


