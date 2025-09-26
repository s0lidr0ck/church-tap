const validator = require('validator');

/**
 * Input validation middleware
 */
const validateInput = (field, options = {}) => {
  return (req, res, next) => {
    const value = req.body[field];
    const errors = [];
    
    // Check if field is required
    if (options.required !== false && (!value || value.trim() === '')) {
      errors.push(`${field} is required`);
    }
    
    // Only validate if value exists
    if (value && value.trim() !== '') {
      const trimmedValue = value.trim();
      
      if (options.minLength && trimmedValue.length < options.minLength) {
        errors.push(`${field} must be at least ${options.minLength} characters long`);
      }
      
      if (options.maxLength && trimmedValue.length > options.maxLength) {
        errors.push(`${field} must be at most ${options.maxLength} characters long`);
      }
      
      if (options.isEmail && !validator.isEmail(trimmedValue)) {
        errors.push(`${field} must be a valid email address`);
      }
      
      if (options.isAlphanumeric && !validator.isAlphanumeric(trimmedValue)) {
        errors.push(`${field} must contain only letters and numbers`);
      }
      
      if (options.matches && !new RegExp(options.matches).test(trimmedValue)) {
        errors.push(`${field} format is invalid`);
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }
    
    next();
  };
};

/**
 * Error handling middleware for validation errors
 */
const handleValidationError = (err, req, res, next) => {
  // Handle errors
  if (err) {
    console.error('Error:', err);
    
    // Handle specific error types
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: err.message
      });
    }
    
    if (err.name === 'UnauthorizedError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }
    
    // Default error response
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
  
  next();
};

// Common validation middlewares
const validateEmail = validateInput('email', { isEmail: true, required: true });
const validatePassword = validateInput('password', { minLength: 6, required: true });
const validateCommunityContent = validateInput('content', { minLength: 1, maxLength: 1000, required: true });
const validateSanitizeHtml = (req, res, next) => {
  // Basic HTML sanitization - remove script tags and other dangerous content
  if (req.body.content) {
    req.body.content = req.body.content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    req.body.content = req.body.content.replace(/<[^>]+>/g, '');
  }
  next();
};

// Export both the function and pre-configured validators
module.exports = {
  validateInput,
  handleValidationError
};

// Add the pre-configured validators to the validateInput function
validateInput.email = validateEmail;
validateInput.password = validatePassword;
validateInput.communityContent = validateCommunityContent;
validateInput.sanitizeHtml = validateSanitizeHtml;
