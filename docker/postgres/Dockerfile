FROM postgres:18

# Install pg_cron extension
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    postgresql-18-cron \
    && rm -rf /var/lib/apt/lists/*

# Add pg_cron to shared_preload_libraries
RUN echo "shared_preload_libraries = 'pg_cron'" >> /usr/share/postgresql/postgresql.conf.sample
