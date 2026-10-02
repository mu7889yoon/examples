package com.example.todo.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record CreateTodoRequest(
		@NotBlank(message = "title is required")
		@Size(max = 200, message = "title must be 200 characters or fewer")
		String title,

		@Size(max = 2_000, message = "description must be 2000 characters or fewer")
		String description,

		LocalDate dueDate
) {
}
