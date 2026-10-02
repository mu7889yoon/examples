package com.example.todo.controller.dto;

import com.example.todo.entity.TodoStatus;
import jakarta.validation.constraints.NotNull;

public record ChangeTodoStatusRequest(
		@NotNull(message = "status is required")
		TodoStatus status
) {
}
