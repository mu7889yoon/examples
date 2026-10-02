package com.example.todo.controller;

import com.example.todo.controller.dto.ChangeTodoStatusRequest;
import com.example.todo.controller.dto.CreateTodoRequest;
import com.example.todo.controller.dto.TodoResponse;
import com.example.todo.controller.dto.UpdateTodoRequest;
import com.example.todo.entity.TodoStatus;
import com.example.todo.service.TodoService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/todos")
public class TodoController {

	private final TodoService service;

	public TodoController(TodoService service) {
		this.service = service;
	}

	@PostMapping
	ResponseEntity<TodoResponse> create(@Valid @RequestBody CreateTodoRequest request) {
		TodoResponse response = TodoResponse.from(
				service.create(request.title(), request.description(), request.dueDate())
		);
		return ResponseEntity.created(URI.create("/api/todos/" + response.id())).body(response);
	}

	@GetMapping
	List<TodoResponse> findAll(@RequestParam(required = false) TodoStatus status) {
		return service.findAll(status).stream().map(TodoResponse::from).toList();
	}

	@GetMapping("/{id}")
	TodoResponse findById(@PathVariable UUID id) {
		return TodoResponse.from(service.findById(id));
	}

	@PutMapping("/{id}")
	TodoResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateTodoRequest request) {
		return TodoResponse.from(
				service.update(id, request.title(), request.description(), request.dueDate())
		);
	}

	@PatchMapping("/{id}/status")
	TodoResponse changeStatus(
			@PathVariable UUID id,
			@Valid @RequestBody ChangeTodoStatusRequest request
	) {
		return TodoResponse.from(service.changeStatus(id, request.status()));
	}

	@DeleteMapping("/{id}")
	ResponseEntity<Void> delete(@PathVariable UUID id) {
		service.delete(id);
		return ResponseEntity.noContent().build();
	}
}
