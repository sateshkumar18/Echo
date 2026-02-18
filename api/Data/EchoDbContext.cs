using Echo.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Echo.Api.Data;

public class EchoDbContext : DbContext
{
    public EchoDbContext(DbContextOptions<EchoDbContext> options) : base(options) { }

    public DbSet<EchoUser> EchoUsers => Set<EchoUser>();
    public DbSet<EchoSession> EchoSessions => Set<EchoSession>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<EchoUser>(e =>
        {
            e.ToTable("echo_users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.DisplayName).HasColumnName("display_name").HasMaxLength(128);
            e.Property(x => x.Email).HasColumnName("email").HasMaxLength(256);
            e.Property(x => x.PasswordHash).HasColumnName("password_hash").HasMaxLength(256);
            e.Property(x => x.SubscriptionTier).HasColumnName("subscription_tier").HasMaxLength(32);
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<EchoSession>(e =>
        {
            e.ToTable("echo_sessions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.UserId).HasColumnName("user_id");
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.FinishedAt).HasColumnName("finished_at");
            e.Property(x => x.ChunkCount).HasColumnName("chunk_count");
            e.Property(x => x.Status).HasColumnName("status").HasMaxLength(32);
            e.Property(x => x.Transcript).HasColumnName("transcript");
            e.Property(x => x.Summary).HasColumnName("summary");
            e.Property(x => x.ProcessedAt).HasColumnName("processed_at");
            e.Property(x => x.ErrorMessage).HasColumnName("error_message");
        });
    }
}
