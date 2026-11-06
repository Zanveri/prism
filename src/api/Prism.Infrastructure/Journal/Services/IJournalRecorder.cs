using Prism.Infrastructure.Journal.Models;

namespace Prism.Infrastructure.Journal.Services;

public interface IJournalRecorder
{
    long Begin(JournalEntryStart start);

    void Complete(long id, JournalEntryEnd end);

    void Record(JournalEntryStart start, JournalEntryEnd end);
}
