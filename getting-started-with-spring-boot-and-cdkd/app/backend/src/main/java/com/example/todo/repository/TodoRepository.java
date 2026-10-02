package com.example.todo.repository;

import com.example.todo.entity.Todo;
import com.example.todo.entity.TodoStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface TodoRepository extends JpaRepository<Todo, UUID> {

	List<Todo> findAllByOrderByCreatedAtDesc();

	List<Todo> findByStatusOrderByCreatedAtDesc(TodoStatus status);
}
