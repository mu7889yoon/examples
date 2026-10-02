package com.example.todo.service;

import com.example.todo.entity.Todo;
import com.example.todo.entity.TodoStatus;
import com.example.todo.exception.TodoNotFoundException;
import com.example.todo.repository.TodoRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TodoServiceTest {

	private static final Instant NOW = Instant.parse("2026-08-13T00:00:00Z");

	@Mock
	private TodoRepository repository;

	private TodoService service;

	@BeforeEach
	void setUp() {
		Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
		service = new TodoService(repository, clock);
	}

	@Test
	void createsATodoUsingTheInjectedClock() {
		when(repository.saveAndFlush(any(Todo.class))).thenAnswer(invocation -> invocation.getArgument(0));

		Todo result = service.create("Learn DI", null, null);

		assertThat(result.getTitle()).isEqualTo("Learn DI");
		assertThat(result.getCreatedAt()).isEqualTo(NOW);
		verify(repository).saveAndFlush(result);
	}

	@Test
	void filtersTodosByStatus() {
		Todo completed = Todo.create("Learn JPA", null, null, NOW);
		completed.changeStatus(TodoStatus.COMPLETED, NOW.plusSeconds(60));
		when(repository.findByStatusOrderByCreatedAtDesc(TodoStatus.COMPLETED))
				.thenReturn(List.of(completed));

		List<Todo> result = service.findAll(TodoStatus.COMPLETED);

		assertThat(result).containsExactly(completed);
	}

	@Test
	void reportsAnUnknownTodo() {
		UUID id = UUID.randomUUID();
		when(repository.findById(id)).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.findById(id))
				.isInstanceOf(TodoNotFoundException.class)
				.hasMessageContaining(id.toString());
	}
}
