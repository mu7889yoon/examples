package com.example.todo.controller.dto;

import com.example.todo.entity.Todo;
import com.example.todo.entity.TodoStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record TodoResponse(
		UUID id,
		String title,
		String description,
		LocalDate dueDate,
		TodoStatus status,
		Instant completedAt,
		Instant createdAt,
		Instant updatedAt,
		Long version
) {

	public static TodoResponse from(Todo todo) {
		return new TodoResponse(
				todo.getId(),
				todo.getTitle(),
				todo.getDescription(),
				todo.getDueDate(),
				todo.getStatus(),
				todo.getCompletedAt(),
				todo.getCreatedAt(),
				todo.getUpdatedAt(),
				todo.getVersion()
		);
	}
}
