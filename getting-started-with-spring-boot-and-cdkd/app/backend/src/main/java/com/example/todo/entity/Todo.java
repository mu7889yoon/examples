package com.example.todo.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "todos")
public class Todo {

	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(nullable = false, length = 200)
	private String title;

	@Column(length = 2_000)
	private String description;

	@Column(name = "due_date")
	private LocalDate dueDate;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private TodoStatus status;

	@Column(name = "completed_at")
	private Instant completedAt;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Version
	@Column(nullable = false)
	private Long version;

	protected Todo() {
	}

	private Todo(String title, String description, LocalDate dueDate, Instant now) {
		this.title = normalizeTitle(title);
		this.description = normalizeDescription(description);
		this.dueDate = dueDate;
		this.status = TodoStatus.OPEN;
		this.createdAt = Objects.requireNonNull(now);
		this.updatedAt = now;
	}

	public static Todo create(String title, String description, LocalDate dueDate, Instant now) {
		return new Todo(title, description, dueDate, now);
	}

	public void update(String title, String description, LocalDate dueDate, Instant now) {
		this.title = normalizeTitle(title);
		this.description = normalizeDescription(description);
		this.dueDate = dueDate;
		this.updatedAt = Objects.requireNonNull(now);
	}

	public void changeStatus(TodoStatus newStatus, Instant now) {
		Objects.requireNonNull(newStatus);
		Objects.requireNonNull(now);

		if (status == newStatus) {
			return;
		}

		status = newStatus;
		completedAt = newStatus == TodoStatus.COMPLETED ? now : null;
		updatedAt = now;
	}

	private static String normalizeTitle(String value) {
		String normalized = Objects.requireNonNull(value).trim();
		if (normalized.isEmpty()) {
			throw new IllegalArgumentException("title must not be blank");
		}
		if (normalized.length() > 200) {
			throw new IllegalArgumentException("title must be 200 characters or fewer");
		}
		return normalized;
	}

	private static String normalizeDescription(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		String normalized = value.trim();
		if (normalized.length() > 2_000) {
			throw new IllegalArgumentException("description must be 2000 characters or fewer");
		}
		return normalized;
	}

	public UUID getId() {
		return id;
	}

	public String getTitle() {
		return title;
	}

	public String getDescription() {
		return description;
	}

	public LocalDate getDueDate() {
		return dueDate;
	}

	public TodoStatus getStatus() {
		return status;
	}

	public Instant getCompletedAt() {
		return completedAt;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}

	public Long getVersion() {
		return version;
	}
}
