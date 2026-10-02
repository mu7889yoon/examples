package com.example.todo.controller;

import com.example.todo.exception.TodoNotFoundException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

	@ExceptionHandler(TodoNotFoundException.class)
	ProblemDetail handleNotFound(TodoNotFoundException exception) {
		return problem(HttpStatus.NOT_FOUND, "Todo not found", exception.getMessage());
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	ProblemDetail handleValidation(MethodArgumentNotValidException exception) {
		Map<String, String> fieldErrors = new LinkedHashMap<>();
		exception.getBindingResult().getFieldErrors().forEach(error ->
				fieldErrors.putIfAbsent(error.getField(), error.getDefaultMessage()));

		ProblemDetail problem = problem(
				HttpStatus.BAD_REQUEST,
				"Request validation failed",
				"One or more request fields are invalid"
		);
		problem.setProperty("fieldErrors", fieldErrors);
		return problem;
	}

	@ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
	ProblemDetail handleMalformedRequest(Exception exception) {
		return problem(
				HttpStatus.BAD_REQUEST,
				"Malformed request",
				"The request contains an invalid value or JSON body"
		);
	}

	@ExceptionHandler(IllegalArgumentException.class)
	ProblemDetail handleIllegalArgument(IllegalArgumentException exception) {
		return problem(HttpStatus.BAD_REQUEST, "Invalid request", exception.getMessage());
	}

	@ExceptionHandler({OptimisticLockingFailureException.class, DataIntegrityViolationException.class})
	ProblemDetail handleConflict(RuntimeException exception) {
		return problem(
				HttpStatus.CONFLICT,
				"Todo conflict",
				"The todo was changed by another request or violates the current state"
		);
	}

	private ProblemDetail problem(HttpStatus status, String title, String detail) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
		problem.setTitle(title);
		problem.setProperty("timestamp", Instant.now());
		return problem;
	}
}
