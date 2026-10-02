CREATE TABLE todos (
    id UUID PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(2000),
    due_date DATE,
    status VARCHAR(20) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT todos_status_check CHECK (status IN ('OPEN', 'COMPLETED')),
    CONSTRAINT todos_completed_at_check CHECK (
        (status = 'OPEN' AND completed_at IS NULL)
        OR (status = 'COMPLETED' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX todos_created_at_idx ON todos (created_at DESC);
CREATE INDEX todos_status_created_at_idx ON todos (status, created_at DESC);
