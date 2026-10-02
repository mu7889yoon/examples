package com.example.todo.service;

import com.example.todo.entity.Todo;
import com.example.todo.entity.TodoStatus;
import com.example.todo.exception.TodoNotFoundException;
import com.example.todo.repository.TodoRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class TodoService {

	private final TodoRepository repository;
	private final Clock clock;

	public TodoService(TodoRepository repository, Clock clock) {
		this.repository = repository;
		this.clock = clock;
	}

	public Todo create(String title, String description, LocalDate dueDate) {
		Todo todo = Todo.create(title, description, dueDate, clock.instant());
		return repository.saveAndFlush(todo);
	}

	@Transactional(readOnly = true)
	public List<Todo> findAll(TodoStatus status) {
		if (status == null) {
			return repository.findAllByOrderByCreatedAtDesc();
		}
		return repository.findByStatusOrderByCreatedAtDesc(status);
	}

	@Transactional(readOnly = true)
	public Todo findById(UUID id) {
		return findRequired(id);
	}

	public Todo update(UUID id, String title, String description, LocalDate dueDate) {
		Todo todo = findRequired(id);
		todo.update(title, description, dueDate, clock.instant());
		return repository.saveAndFlush(todo);
	}

	public Todo changeStatus(UUID id, TodoStatus status) {
		Todo todo = findRequired(id);
		todo.changeStatus(status, clock.instant());
		return repository.saveAndFlush(todo);
	}

	public void delete(UUID id) {
		Todo todo = findRequired(id);
		repository.delete(todo);
	}

	private Todo findRequired(UUID id) {
		return repository.findById(id).orElseThrow(() -> new TodoNotFoundException(id));
	}
}
