package com.example.todo.entity;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TodoTest {

	private static final Instant NOW = Instant.parse("2026-08-13T00:00:00Z");

	@Test
	void createsAnOpenTodoAndNormalizesText() {
		Todo todo = Todo.create(
				"  Learn Spring Boot  ",
				"  Build a REST API  ",
				LocalDate.parse("2026-08-31"),
				NOW
		);

		assertThat(todo.getTitle()).isEqualTo("Learn Spring Boot");
		assertThat(todo.getDescription()).isEqualTo("Build a REST API");
		assertThat(todo.getStatus()).isEqualTo(TodoStatus.OPEN);
		assertThat(todo.getCompletedAt()).isNull();
		assertThat(todo.getCreatedAt()).isEqualTo(NOW);
		assertThat(todo.getUpdatedAt()).isEqualTo(NOW);
	}

	@Test
	void completesAndReopensATodo() {
		Todo todo = Todo.create("Learn Spring Boot", null, null, NOW);
		Instant completedAt = NOW.plusSeconds(60);

		todo.changeStatus(TodoStatus.COMPLETED, completedAt);

		assertThat(todo.getStatus()).isEqualTo(TodoStatus.COMPLETED);
		assertThat(todo.getCompletedAt()).isEqualTo(completedAt);

		Instant reopenedAt = NOW.plusSeconds(120);
		todo.changeStatus(TodoStatus.OPEN, reopenedAt);

		assertThat(todo.getStatus()).isEqualTo(TodoStatus.OPEN);
		assertThat(todo.getCompletedAt()).isNull();
		assertThat(todo.getUpdatedAt()).isEqualTo(reopenedAt);
	}

	@Test
	void rejectsABlankTitle() {
		assertThatThrownBy(() -> Todo.create("  ", null, null, NOW))
				.isInstanceOf(IllegalArgumentException.class)
				.hasMessage("title must not be blank");
	}
}
