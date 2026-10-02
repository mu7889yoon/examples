package com.example.todo.exception;

import java.util.UUID;

public class TodoNotFoundException extends RuntimeException {

	public TodoNotFoundException(UUID id) {
		super("Todo was not found: " + id);
	}
}
