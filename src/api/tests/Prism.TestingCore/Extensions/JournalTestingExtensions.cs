using Prism.Infrastructure.Journal.Services;

namespace Prism.TestingCore.Extensions;

public static class JournalTestingExtensions
{
    public static byte[]? LastKeyBufferForTesting(this IJournalService journalService)
        => ((JournalService)journalService).LastKeyBufferForTesting;
}
